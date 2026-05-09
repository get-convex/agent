/**
 * Full Streaming Demo
 *
 * Demonstrates ALL streaming patterns in one place:
 * 1. Async delta streaming (recommended) - mutation saves prompt, action streams
 * 2. HTTP streaming - direct text stream over HTTP response
 * 3. One-shot streaming - single action call with delta persistence
 * 4. Stream lifecycle management - abort, status transitions, cleanup
 * 5. Tool approval - pauses generation, resumes after approve/deny
 */
import { paginationOptsValidator } from "convex/server";
import {
  listUIMessages,
  syncStreams,
  abortStream,
  listStreams,
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
import { streamingDemoAgent } from "../agents/streamingDemo";

// ============================================================================
// Pattern 1: Async Delta Streaming (RECOMMENDED)
//
// Two-phase approach:
//   Phase 1 (mutation): Save the user message and schedule the action.
//   Phase 2 (action):   Stream the AI response, saving deltas to the DB.
//
// Clients subscribe via `useUIMessages` with `stream: true` and see real-time
// delta updates through Convex's reactive query system.
// ============================================================================

export const sendMessage = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { messageId } = await streamingDemoAgent.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.chat.streamingDemo.streamResponse,
      { threadId, promptMessageId: messageId },
    );
  },
});

export const streamResponse = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const result = await streamingDemoAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});

// ============================================================================
// Pattern 2: HTTP Streaming
//
// Streams text directly over an HTTP response using `agent.asHttpAction()`.
// The handler parses the JSON body, creates a thread if needed, streams
// the response, and sets X-Message-Id / X-Stream-Id headers.
//
// `saveStreamDeltas: { returnImmediately: true }` saves deltas in the
// background so `useUIMessages` can dedupe by `streamId` AND the response
// body starts streaming immediately. Plain `true` would buffer the full
// generation before opening the body.
// ============================================================================

export const streamOverHttp = httpAction(
  streamingDemoAgent.asHttpAction({
    saveStreamDeltas: { returnImmediately: true },
  }),
);

// ============================================================================
// Pattern 3: One-Shot Streaming
//
// Single action call that both streams and persists deltas. Simpler than
// the two-phase approach but does not support optimistic client updates.
// ============================================================================

export const streamOneShot = action({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    await streamingDemoAgent.streamText(
      ctx,
      { threadId },
      { prompt },
      { saveStreamDeltas: true },
    );
  },
});

// ============================================================================
// Tool Approval
//
// When the model calls a tool with `needsApproval`, generation pauses.
// The client shows Approve/Deny buttons; once resolved, the client triggers
// continuation via delta streaming.
// ============================================================================

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
      ? await streamingDemoAgent.approveToolCall(ctx, {
          threadId,
          approvalId,
          reason,
        })
      : await streamingDemoAgent.denyToolCall(ctx, {
          threadId,
          approvalId,
          reason,
        });
    return { messageId };
  },
});

export const triggerContinuation = mutation({
  args: { threadId: v.string(), lastApprovalMessageId: v.string() },
  handler: async (ctx, { threadId, lastApprovalMessageId }) => {
    await authorizeThreadAccess(ctx, threadId);
    await ctx.scheduler.runAfter(
      0,
      internal.chat.streamingDemo.continueAfterApprovals,
      { threadId, lastApprovalMessageId },
    );
  },
});

export const continueAfterApprovals = internalAction({
  args: { threadId: v.string(), lastApprovalMessageId: v.string() },
  handler: async (ctx, { threadId, lastApprovalMessageId }) => {
    const result = await streamingDemoAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId: lastApprovalMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});

// ============================================================================
// Queries: Messages + Stream Sync
// ============================================================================

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

export const listActiveStreams = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    return listStreams(ctx, components.agent, { threadId });
  },
});

// ============================================================================
// Stream Lifecycle Management
// ============================================================================

export const abortStreamByOrder = mutation({
  args: { threadId: v.string(), order: v.number() },
  handler: async (ctx, { threadId, order }) => {
    await authorizeThreadAccess(ctx, threadId);
    return abortStream(ctx, components.agent, {
      threadId,
      order,
      reason: "User requested abort",
    });
  },
});

export const listAllStreams = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    return listStreams(ctx, components.agent, {
      threadId,
      includeStatuses: ["streaming", "finished", "aborted"],
    });
  },
});
