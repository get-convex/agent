// See the docs at https://docs.convex.dev/agents/rag
import { RAG } from "@convex-dev/rag";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { action, internalAction, mutation } from "../_generated/server";
import { openai } from "@ai-sdk/openai";
import { agent } from "../agents/simple";
import { authorizeThreadAccess } from "../threads";

export const rag = new RAG(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small") as any,
  embeddingDimension: 1536,
});

/**
 * Add context to the RAG index.
 * This is used to search for context when the user asks a question.
 */
export const addContext = action({
  args: { title: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    // TODO: Add authorization
    await rag.add(ctx, {
      namespace: "global", // Could set a per-user namespace here
      title: args.title,
      key: args.title,
      text: args.text,
    });
  },
});

/**
 * Answer a user question via RAG.
 * It looks up chunks of context in the RAG index and uses them in the prompt.
 * This is started asynchronously after saving the prompt message to the thread
 * (see askQuestion below).
 */
export const answerQuestionViaRAG = internalAction({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { threadId, prompt: rawPrompt, promptMessageId }) => {
    const { thread } = await agent.continueThread(ctx, { threadId });

    // Search the RAG index for context.
    const context = await rag.search(ctx, {
      namespace: "global",
      query: rawPrompt,
      limit: 2,
      chunkContext: { before: 1, after: 1 },
    });

    // Basic prompt to instruct the LLM to use the context to answer the question.
    // Note: for gemini / claude, using `<context>` and `<question>` tags is
    // recommended instead of the markdown format below.
    const prompt = `# Context:\n\n ${context.text}\n\n---\n\n# Question:\n\n"""${rawPrompt}\n"""`;
    // Override the system prompt for demo purposes.
    const system =
      "Answer the user's question and explain what context you used to answer it.";

    const result = await thread.streamText(
      // By providing both prompt and promptMessageId, it will use the prompt
      // in place of the promptMessageId's message, but still be considered
      // a response to the promptMessageId message (raw prompt).
      { prompt, promptMessageId, system },
      { saveStreamDeltas: true }, // to enable streaming the response via websockets.
    );
    // To show the context in the demo UI, we record the context used
    await ctx.runMutation(internal.rag.utils.recordContextUsed, {
      messageId: result.messageId,
      entries: context.entries,
      results: context.results,
    });
    // This is necessary to ensure the stream is finished before returning.
    await result.consumeStream();
  },
});

export const askQuestion = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, { threadId, prompt }) => {
    await authorizeThreadAccess(ctx, threadId);
    // Save the raw prompt message to the thread. We'll associate the response
    // with this message below.
    const { messageId } = await agent.saveMessage(ctx, {
      threadId,
      prompt,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.rag.ragAsPrompt.answerQuestionViaRAG,
      { threadId, prompt, promptMessageId: messageId },
    );
  },
});
