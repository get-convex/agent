// See the docs at https://docs.convex.dev/agents/messages
import { paginationOptsValidator } from "convex/server";
import {
  createThread,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import {
  action,
  httpAction,
  internalAction,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { authorizeThreadAccess } from "../threads";
import { storyAgent } from "../agents/story";

/**
 * OPTION 1:
 * Stream the response in a single action call.
 */

export const streamOneShot = action({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const message = await storyAgent.streamText(
      ctx,
      { threadId },
      { prompt },
      { saveStreamDeltas: true },
    );
    // We don't need to return anything, as the response is saved as deltas
    // in the database and clients are subscribed to the stream.
  },
});

/**
 * OPTION 2 (RECOMMENDED):
 * Generate the prompt message first, then asynchronously generate the stream response.
 * This enables optimistic updates on the client.
 */

export const initiateAsyncStreaming = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { messageId } = await storyAgent.saveMessage(ctx, {
      threadId,
      prompt,
      // we're in a mutation, so skip embeddings for now. They'll be generated
      // lazily when streaming text.
      skipEmbeddings: true,
    });
    await ctx.scheduler.runAfter(0, internal.chat.streaming.streamAsync, {
      threadId,
      promptMessageId: messageId,
    });
  },
});

export const streamAsync = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const result = await storyAgent.streamText(
      ctx,
      { threadId },
      {
        promptMessageId,
        onStepFinish: async (step, test) => {
          await ctx.runAction(components.cost.cost.addCost, {
            messageId: test?.messageId!,
            userId: test?.userId,
            threadId: test?.threadId!,
            modelId: step.response.modelId,
            usage: {
              reasoningTokens: step.usage.reasoningTokens,
              cachedInputTokens: step.usage.cachedInputTokens,
              completionTokens: step.usage.outputTokens as number,
              promptTokens: step.usage.inputTokens as number,
              totalTokens: step.usage.totalTokens as number,
            },
          });
        },
      },
      // more custom delta options (`true` uses defaults)
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    // We need to make sure the stream finishes - by awaiting each chunk
    // or using this call to consume it all.
    await result.consumeStream();
  },
});

/**
 * Query & subscribe to messages & threads
 */

export const listThreadMessages = query({
  args: {
    // These arguments are required:
    threadId: v.string(),
    paginationOpts: paginationOptsValidator, // Used to paginate the messages.
    streamArgs: vStreamArgs, // Used to stream messages.
  },
  handler: async (ctx, args) => {
    const { threadId, streamArgs } = args;
    await authorizeThreadAccess(ctx, threadId);
    const streams = await syncStreams(ctx, components.agent, {
      threadId,
      streamArgs,
    });
    // Here you could filter out / modify the stream of deltas / filter out
    // deltas.

    const paginated = await listUIMessages(ctx, components.agent, args);

    // Here you could filter out metadata that you don't want from any optional
    // fields on the messages.
    // You can also join data onto the messages. They need only extend the
    // MessageDoc type.
    // { ...messages, page: messages.page.map(...)}

    return {
      ...paginated,
      streams,

      // ... you can return other metadata here too.
      // note: this function will be called with various permutations of delta
      // and message args, so returning derived data .
    };
  },
});

/**
 * ==============================
 * Other ways of doing things:
 * ==============================
 */

/**
 * OPTION 3:
 * Stream the text but don't persist the message until it's done.
 * This allows you to start processing the result in the action itself.
 * To stream the result back over http, see the next example.
 */
export const streamTextWithoutSavingDeltas = action({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    const threadId = await createThread(ctx, components.agent);
    const result = await storyAgent.streamText(ctx, { threadId }, { prompt });
    for await (const chunk of result.textStream) {
      // do something with the chunks as they come in.
      console.log(chunk);
    }
    return {
      threadId,
      text: await result.text,
      toolCalls: await result.toolCalls,
      toolResults: await result.toolResults,
    };
  },
});

/**
 * OPTION 4:
 * Stream text over http but don't persist the message until it's done.
 * This can be an alternative if you only care about streaming to one client
 * and waiting for the final result if the http request is interrupted / for
 * other clients.
 *
 * Warning: Optimistic updates are hard to get right with this approach.
 *
 * Note: you can also save deltas if you want so all clients can stream them.
 */
export const streamOverHttp = httpAction(async (ctx, request) => {
  const body = (await request.json()) as {
    threadId?: string;
    prompt: string;
  };
  const threadId = body.threadId ?? (await createThread(ctx, components.agent));
  const result = await storyAgent.streamText(ctx, { threadId }, body);
  const response = result.toTextStreamResponse();
  // Set this so the client can try to de-dupe showing the streamed message and
  // the final result.
  response.headers.set("X-Message-Id", result.promptMessageId!);
  return response;
});

// Expose an internal action that streams text, to avoid the boilerplate of
// streamStory above.
export const streamStoryInternalAction = storyAgent.asTextAction({
  stream: true,
  // stream: { chunking: "word", throttleMs: 200 },
});

// This fetches only streaming messages.
export const listStreamingMessages = query({
  args: { threadId: v.string(), streamArgs: vStreamArgs },
  handler: async (ctx, { threadId, streamArgs }) => {
    await authorizeThreadAccess(ctx, threadId);
    const streams = await storyAgent.syncStreams(ctx, { threadId, streamArgs });
    return { streams };
  },
});
