/**
 * Traced Chat Example
 *
 * This example demonstrates using LangFuse tracing with a Convex Agent.
 * It shows how to configure an agent to send traces to LangFuse for
 * observability and debugging.
 *
 * The traces will appear in your LangFuse dashboard, showing:
 * - Each LLM request/response
 * - Token usage
 * - Model parameters
 * - Thread and user context
 */

import { Agent } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import { action, internalAction, mutation, query } from "../_generated/server";
import { listMessages, saveMessage } from "@convex-dev/agent";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { languageModel, textEmbeddingModel } from "../modelsForDemo";
import {
  langfuseRequestResponseHandler,
  langfuseUsageHandler,
  isLangfuseConfigured,
} from "./langfuseHandler";
import { authorizeThreadAccess } from "../threads";

/**
 * Agent configured with LangFuse tracing.
 *
 * This agent will send all LLM interactions to LangFuse for observability.
 * Make sure to set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY environment
 * variables in your Convex deployment.
 */
export const tracedAgent = new Agent(components.agent, {
  name: "Traced Agent",
  instructions:
    "You are a helpful assistant. Your responses are being traced " +
    "with LangFuse for observability. Be concise and helpful.",

  // LangFuse handlers for tracing
  rawRequestResponseHandler: langfuseRequestResponseHandler,
  usageHandler: langfuseUsageHandler,

  // Standard model configuration
  languageModel,
  textEmbeddingModel,
  callSettings: {
    temperature: 0.7,
  },
});

/**
 * Send a message and generate a traced response.
 * Uses the mutation + async action pattern for optimistic updates.
 */
export const sendMessage = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.tracing.tracedChat.generateResponse,
      {
        threadId,
        promptMessageId: messageId,
      }
    );
  },
});

/**
 * Generate a traced response to a user message.
 * This action will send traces to LangFuse.
 */
export const generateResponse = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    await tracedAgent.generateText(ctx, { threadId }, { promptMessageId });
  },
});

/**
 * List messages in a thread.
 */
export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { threadId, paginationOpts } = args;
    await authorizeThreadAccess(ctx, threadId);
    return await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts,
    });
  },
});

/**
 * Check if LangFuse is configured.
 * Returns true if the required environment variables are set.
 */
export const checkLangfuseConfig = action({
  args: {},
  handler: async () => {
    return {
      configured: isLangfuseConfigured(),
      baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
    };
  },
});
