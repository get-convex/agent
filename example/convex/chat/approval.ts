// Tool Approval Demo - Convex Functions
// Demonstrates the AI SDK v6 two-call model for tool approval
import { paginationOptsValidator } from "convex/server";
import {
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import {
  internalAction,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { authorizeThreadAccess } from "../threads";
import { approvalAgent } from "../agents/approval";

/**
 * Send a message and start generation.
 * If the agent uses a tool that requires approval, it will pause and
 * return a tool-approval-request in the response.
 */
export const sendMessage = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);

    // Save the user's message
    const { messageId } = await approvalAgent.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    });

    // Start async generation
    await ctx.scheduler.runAfter(0, internal.chat.approval.generateResponse, {
      threadId,
      promptMessageId: messageId,
    });

    return { messageId };
  },
});

/**
 * Internal action that generates the response.
 * This will stop if a tool requires approval.
 */
export const generateResponse = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const result = await approvalAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});

/**
 * Submit an approval response for a pending tool call.
 * Schedules the appropriate action to handle approval or denial.
 */
export const submitApproval = mutation({
  args: {
    threadId: v.string(),
    approvalId: v.string(),
    approved: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, approvalId, approved, reason }) => {
    await authorizeThreadAccess(ctx, threadId);

    if (approved) {
      await ctx.scheduler.runAfter(0, internal.chat.approval.handleApproval, {
        threadId,
        approvalId,
        reason,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.chat.approval.handleDenial, {
        threadId,
        approvalId,
        reason,
      });
    }

    return { approved };
  },
});

/**
 * Handle an approved tool call.
 * Uses the Agent helper to execute the tool and continue generation.
 */
export const handleApproval = internalAction({
  args: {
    threadId: v.string(),
    approvalId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, approvalId, reason }) => {
    const result = await approvalAgent.approveToolCall(ctx, {
      threadId,
      approvalId,
      reason,
    });
    await result.consumeStream();
  },
});

/**
 * Handle a denied tool call.
 * Uses the Agent helper to save the denial and let the LLM respond.
 */
export const handleDenial = internalAction({
  args: {
    threadId: v.string(),
    approvalId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, approvalId, reason }) => {
    const result = await approvalAgent.denyToolCall(ctx, {
      threadId,
      approvalId,
      reason,
    });
    await result.consumeStream();
  },
});

/**
 * Query messages with streaming support.
 */
export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const { threadId, streamArgs } = args;
    await authorizeThreadAccess(ctx, threadId);

    const streams = await syncStreams(ctx, components.agent, {
      threadId,
      streamArgs,
    });

    const paginated = await listUIMessages(ctx, components.agent, args);

    return {
      ...paginated,
      streams,
    };
  },
});
