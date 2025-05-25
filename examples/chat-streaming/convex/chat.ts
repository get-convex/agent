import { paginationOptsValidator, PaginationResult } from "convex/server";
import { WorkflowManager } from "@convex-dev/workflow";
import { Agent, createTool, vStreamArgs } from "@convex-dev/agent";
import type { ThreadDoc, UsageHandler } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { openai } from "@ai-sdk/openai";
import {
  action,
  ActionCtx,
  httpAction,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { z } from "zod";
import { tool } from "ai";

// Define an agent similarly to the AI SDK
export const storyAgent = new Agent(components.agent, {
  name: "Story Agent",
  chat: openai.chat("gpt-4o-mini"),
  instructions: "You tell stories with twist endings. ~ 200 words.",
  storageOptions: {
    saveStreamDeltas: {
      granularity: "word",
      min: 1,
      throttleMs: 100,
    },
  },
  tools: {
    makeUpName: tool({
      description: "Make up a name for a user",
      parameters: z.object({}),
      execute: async (args, options) => {
        return ["John", "Jane", "Jim", "Jill", "Jack"][
          Math.floor(Math.random() * 5)
        ];
      },
    }),
  },
  maxSteps: 10,
});

// Not streaming, just used for comparison
export const generateStoryWithoutStreaming = action({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { thread } = await storyAgent.continueThread(ctx, { threadId });
    const result = await thread.generateText({ prompt });
    return result.text;
  },
});

// Streaming, but the action doesn't return until the streaming is done.
export const streamStorySynchronously = action({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { thread } = await storyAgent.continueThread(ctx, { threadId });
    const result = await thread.streamText({ prompt });
    for await (const chunk of result.textStream) {
      console.log(chunk);
    }
    return result.text;
  },
});

// Streaming, where generate the prompt message first, then asynchronously
// generate the stream response.
export const streamStoryAsynchronously = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { messageId } = await storyAgent.saveMessage(ctx, {
      threadId,
      prompt,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.example.streamStoryInternalAction,
      { threadId, promptMessageId: messageId },
    );
  },
});

// Expose an internal action that streams text
export const streamStoryInternalAction = storyAgent.asTextAction({
  stream: true,
});

/**
 * Query & subscribe to messages & threads
 */

// Because this takes in streamArgs: vStreamArgs and returns s
export const streamMessageDeltas = query({
  args: {
    // This argument is required:
    streamArgs: vStreamArgs,
    // But you can pass other arguments too:
    threadId: v.string(),
  },
  handler: async (ctx, { streamArgs, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    return storyAgent.syncDeltas(ctx, { threadId, streamArgs });
  },
});

// This fetches full messages. Streamed messages are not included.
export const listMessages = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { page: messages } = await storyAgent.listMessages(ctx, {
      threadId,
      order: "desc",
      take: 10,
    });
    // Return them in ascending order (oldest first)
    return messages.reverse();
  },
});

export const createThread = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = getUserId(ctx);
    const { threadId } = await storyAgent.createThread(ctx, { userId });
    return threadId;
  },
});

async function getUserId(ctx: QueryCtx | MutationCtx | ActionCtx) {
  // For demo purposes. Usually you'd use auth here.
  return "storytelling user";
}

async function authorizeThreadAccess(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  threadId: string,
) {
  // For demo purposes. Usually you'd use auth here.
}
