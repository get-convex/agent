// See the docs at https://docs.convex.dev/agents/tool-approval
//
// Tool Approval Flow:
// 1. User sends message → model calls a tool with needsApproval
// 2. Generation stops with a tool-approval-request in the response
// 3. Client shows Approve/Deny buttons to the user
// 4. User clicks Approve or Deny → saves response, schedules continuation
// 5. AI SDK automatically handles the approval: executes tool (if approved)
//    or creates execution-denied result (if denied), then continues generation
import { paginationOptsValidator } from "convex/server";
import {
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import { internalAction, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { approvalAgent } from "../agents/approval";
import { authorizeThreadAccess } from "../threads";

/**
 * Send a message and start generation.
 * If the model calls a tool that needs approval, generation will pause
 * and the tool-approval-request will appear in the thread messages.
 */
export const sendMessage = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { messageId } = await approvalAgent.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    });
    await ctx.scheduler.runAfter(0, internal.chat.approval.generateResponse, {
      threadId,
      promptMessageId: messageId,
    });
    return { messageId };
  },
});

/**
 * Generate a response. If a tool requires approval, generation stops
 * and the approval-request is persisted in the thread.
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
 * Submit an approval decision for a single tool call.
 * Saves the decision but does NOT continue generation — the client
 * calls continueAfterApprovals once all pending approvals are resolved.
 */
export const submitApproval = mutation({
  args: {
    threadId: v.string(),
    approvalId: v.string(),
    approved: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.object({ messageId: v.string() }),
  handler: async (ctx, { threadId, approvalId, approved, reason }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { messageId } = approved
      ? await approvalAgent.approveToolCall(ctx, { threadId, approvalId, reason })
      : await approvalAgent.denyToolCall(ctx, { threadId, approvalId, reason });
    return { messageId };
  },
});

/**
 * Continue generation after all approvals in a step have been resolved.
 * The client calls this once every pending tool call has been approved or denied.
 */
export const continueAfterApprovals = internalAction({
  args: {
    threadId: v.string(),
    lastApprovalMessageId: v.string(),
  },
  handler: async (ctx, { threadId, lastApprovalMessageId }) => {
    const result = await approvalAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId: lastApprovalMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});

/**
 * Schedule continuation after all approvals are resolved.
 * Called by the client when hasPendingApprovals becomes false.
 */
export const triggerContinuation = mutation({
  args: {
    threadId: v.string(),
    lastApprovalMessageId: v.string(),
  },
  handler: async (ctx, { threadId, lastApprovalMessageId }) => {
    await authorizeThreadAccess(ctx, threadId);
    await ctx.scheduler.runAfter(
      0,
      internal.chat.approval.continueAfterApprovals,
      { threadId, lastApprovalMessageId },
    );
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
    return { ...paginated, streams };
  },
});
