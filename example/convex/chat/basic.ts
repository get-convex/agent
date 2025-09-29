// See the docs at https://docs.convex.dev/agents/messages
import { components, internal } from "../_generated/api";
import { action, internalAction, mutation, query } from "../_generated/server";
import { listMessages, saveMessage } from "@convex-dev/agent";
import { v } from "convex/values";
import { agent } from "../agents/simple";
import { authorizeThreadAccess } from "../threads";
import { paginationOptsValidator } from "convex/server";

/**
 * OPTION 1 (BASIC):
 * Generating via a single action call
 */

export const generateTextInAnAction = action({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const result = await agent.generateText(
      ctx,
      { threadId },
      {
        prompt,
        onStepFinish: async (step, args) => {
          await ctx.runAction(components.cost.cost.addCost, {
            messageId: args?.messageId!,
            userId: args?.userId,
            threadId: args?.threadId!,
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
    );
    return result.text;
  },
});

/**
 * OPTION 2 (RECOMMENDED):
 * Generating via a mutation & async action
 * This enables optimistic updates on the client.
 */

// Save a user message, and kick off an async response.
export const sendMessage = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt,
    });
    await ctx.scheduler.runAfter(0, internal.chat.basic.generateResponse, {
      threadId,
      promptMessageId: messageId,
    });
  },
});

// Generate a response to a user message.
// Any clients listing the messages will automatically get the new message.
export const generateResponse = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    await agent.generateText(
      ctx,
      { threadId },
      {
        promptMessageId,
        onStepFinish: async (step, args) => {
          await ctx.runAction(components.cost.cost.addCost, {
            messageId: args?.messageId!,
            userId: args?.userId,
            threadId: args?.threadId!,
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
    );
  },
});

// Equivalent:
// export const generateResponse = agent.asTextAction();

/**
 * Query & subscribe to messages & threads
 */

export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { threadId, paginationOpts } = args;
    await authorizeThreadAccess(ctx, threadId);
    const messages = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts,
    });
    // You could add more fields here, join with other tables, etc.
    return messages;
  },
});
