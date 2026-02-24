/**
 * Full Streaming Demo
 *
 * Demonstrates ALL streaming patterns in one place:
 * 1. Async delta streaming (recommended) - mutation saves prompt, action streams
 * 2. HTTP streaming - direct text stream over HTTP response
 * 3. One-shot streaming - single action call with delta persistence
 * 4. Stream lifecycle management - abort, status transitions, cleanup
 *
 * This is intended as a comprehensive reference for integrating streaming
 * with @convex-dev/agent.
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
import { agent } from "../agents/simple";

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
    const { messageId } = await agent.saveMessage(ctx, {
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
    const result = await agent.streamText(
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
// Streams text directly over an HTTP response. Useful for single-client
// consumption (e.g., curl, fetch, or SSE-like patterns).
//
// Uses `agent.asHttpAction()` — a factory method that returns a handler
// for httpAction(). It parses the JSON body, creates a thread if needed,
// streams the response, and sets X-Message-Id / X-Stream-Id headers.
//
// Note: deltas are NOT saved by default here. To save deltas AND stream over
// HTTP simultaneously, add `saveStreamDeltas: true` to the options.
// ============================================================================

export const streamOverHttp = httpAction(
  agent.asHttpAction(),
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
    await agent.streamText(
      ctx,
      { threadId },
      { prompt },
      { saveStreamDeltas: true },
    );
  },
});

// ============================================================================
// Queries: Messages + Stream Sync
// ============================================================================

/**
 * The main query used by useUIMessages. Returns paginated messages PLUS
 * live stream deltas so the React hook can merge them into a single list.
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

/**
 * Returns only active streaming messages (no paginated history).
 * Useful for a lightweight "is anything streaming?" indicator.
 */
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

/**
 * Abort a stream by its order (message position in thread).
 * This is the user-facing "Stop" button action.
 */
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

/**
 * Query all streams for a thread including finished and aborted ones.
 * Useful for debugging and the demo's stream inspector panel.
 */
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
