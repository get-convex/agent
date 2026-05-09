# Technical Requirements: HTTP Streaming for @convex-dev/agent

## Status: Draft
## Date: 2026-02-23

---

## 1. Executive Summary

The current streaming architecture relies exclusively on Convex's reactive query system (WebSocket-based delta polling). This document specifies requirements for adding HTTP streaming support, including delta filtering logic, stream ID lifecycle management, and backwards compatibility constraints.

---

## 2. Current Architecture

### 2.1 Streaming Transport (WebSocket Delta Polling)

The existing system persists stream data as discrete deltas in the database, which clients poll via Convex reactive queries. There is no HTTP streaming transport.

**Flow:**
1. `DeltaStreamer` (client action) writes compressed parts via `streams.addDelta` mutations
2. React hooks (`useDeltaStreams`) issue two reactive queries per render cycle:
   - `kind: "list"` — discovers active `streamingMessages` for the thread
   - `kind: "deltas"` — fetches new deltas using per-stream cursors
3. `deriveUIMessagesFromDeltas()` materializes `UIMessage[]` from accumulated deltas

**Key files:**
- `src/client/streaming.ts` — `DeltaStreamer` class, compression, `syncStreams()`
- `src/component/streams.ts` — Backend mutations/queries (`create`, `addDelta`, `listDeltas`, `finish`, `abort`)
- `src/react/useDeltaStreams.ts` — Client-side cursor tracking and delta accumulation
- `src/deltas.ts` — Delta-to-UIMessage materialization

### 2.2 Stream State Machine

```
  create()          addDelta() (with heartbeat)
    │                    │
    ▼                    ▼
┌──────────┐      ┌──────────┐
│ streaming │─────▶│ streaming │──── heartbeat every ~2.5 min
└──────────┘      └──────────┘
    │                    │
    │  finish()          │  abort() / timeout (10 min)
    ▼                    ▼
┌──────────┐      ┌─────────┐
│ finished │      │ aborted │
└──────────┘      └─────────┘
    │
    │  cleanup (5 min delay)
    ▼
  [deleted]
```

### 2.3 Data Formats

Two delta formats are supported, declared per-stream:

| Format | Description | Primary Use |
|--------|-------------|-------------|
| `UIMessageChunk` | AI SDK v6 native format (`text-delta`, `tool-input-delta`, `reasoning-delta`, etc.) | Default for new streams |
| `TextStreamPart` | Legacy AI SDK format | Backwards compatibility |

---

## 3. HTTP Streaming Requirements

### 3.1 Transport Layer

**REQ-HTTP-1**: Provide an HTTP streaming endpoint that emits deltas as Server-Sent Events (SSE) or newline-delimited JSON (NDJSON), enabling clients that cannot use Convex WebSocket subscriptions (e.g., non-JS environments, CLI tools, third-party integrations).

**REQ-HTTP-2**: The HTTP endpoint must support resumption. A client that disconnects and reconnects with a cursor value must receive only deltas it hasn't seen, not replay the full stream.

**REQ-HTTP-3**: The HTTP endpoint must respect the same rate-limiting constants as the WebSocket path:
- `MAX_DELTAS_PER_REQUEST = 1000` (total across all streams)
- `MAX_DELTAS_PER_STREAM = 100` (per stream per request)

**REQ-HTTP-4**: The HTTP endpoint must support filtering by stream status (`streaming`, `finished`, `aborted`) matching the existing `listStreams` query interface.

**REQ-HTTP-5**: The HTTP endpoint must emit a terminal event when the stream reaches `finished` or `aborted` state, so clients know to stop polling/listening.

### 3.2 Response Format

**REQ-HTTP-6**: Each SSE/NDJSON frame must include:
```typescript
{
  streamId: string;       // ID of the streaming message
  start: number;          // Inclusive cursor position
  end: number;            // Exclusive cursor position
  parts: any[];           // Delta parts (UIMessageChunk[] or TextStreamPart[])
}
```

This matches the existing `StreamDelta` type (`src/validators.ts:628-634`).

**REQ-HTTP-7**: Stream metadata must be available either as an initial frame or via a separate endpoint, containing:
```typescript
{
  streamId: string;
  status: "streaming" | "finished" | "aborted";
  format: "UIMessageChunk" | "TextStreamPart" | undefined;
  order: number;
  stepOrder: number;
  userId?: string;
  agentName?: string;
  model?: string;
  provider?: string;
  providerOptions?: ProviderOptions;
}
```

This matches the existing `StreamMessage` type (`src/validators.ts:607-626`).

---

## 4. Delta Stream Filtering Logic

### 4.1 Server-Side Filtering

**REQ-FILT-1**: The `listDeltas` query must continue to filter by stream ID + cursor position using the `streamId_start_end` index:
```
.withIndex("streamId_start_end", (q) =>
  q.eq("streamId", cursor.streamId).gte("start", cursor.cursor))
```

**REQ-FILT-2**: Stream discovery (`list` query) must filter by:
- `threadId` (required) — scoped to a single thread
- `state.kind` (optional, defaults to `["streaming"]`) — which statuses to include
- `startOrder` (optional, defaults to 0) — minimum message order position

This uses the compound index `threadId_state_order_stepOrder`.

**REQ-FILT-3**: For HTTP streaming, add support for filtering deltas by a single `streamId` (not requiring `threadId`), for clients that already know which stream they want to follow.

### 4.2 Client-Side Filtering

**REQ-FILT-4**: The `useDeltaStreams` hook's cursor management must be preserved:
- Per-stream cursor tracking via `Record<string, number>`
- Gap detection: assert `previousEnd === delta.start` for consecutive deltas
- Stale delta rejection: skip deltas where `delta.start < oldCursor`
- Cache-friendly `startOrder` rounding (round down to nearest 10)

**REQ-FILT-5**: Support `skipStreamIds` filtering to allow callers to exclude specific streams (used when streams are already materialized from stored messages).

### 4.3 Delta Compression

**REQ-FILT-6**: Delta compression must happen before persistence (in `DeltaStreamer.#createDelta`). Two compression strategies:

1. **UIMessageChunk compression** (`compressUIMessageChunks`):
   - Merge consecutive `text-delta` parts with same `id` by concatenating `.delta`
   - Merge consecutive `reasoning-delta` parts with same `id` by concatenating `.delta`

2. **TextStreamPart compression** (`compressTextStreamParts`):
   - Merge consecutive `text-delta` parts with same `id` by concatenating `.text`
   - Merge consecutive `reasoning-delta` parts with same `id` by concatenating `.text`
   - Strip `Uint8Array` data from `file` parts (not suitable for delta transport)

**REQ-FILT-7**: Throttling must remain configurable per-stream:
- Default: `250ms` between delta writes
- Configurable via `StreamingOptions.throttleMs`
- Chunking granularity: `"word"`, `"line"`, `RegExp`, or custom `ChunkDetector` (default: `/[\p{P}\s]/u` — punctuation + whitespace)

---

## 5. Stream ID Tracking

### 5.1 Stream ID Lifecycle

**REQ-SID-1**: Stream IDs are Convex document IDs (`Id<"streamingMessages">`) generated lazily on first delta write:
- `DeltaStreamer.getStreamId()` creates the stream via `streams.create` mutation
- Race-condition safe: only one creation promise via `#creatingStreamIdPromise`
- Stream ID is `undefined` until the first `addParts()` call

**REQ-SID-2**: The `streams.create` mutation must:
1. Insert a `streamingMessages` document with `state: { kind: "streaming", lastHeartbeat: Date.now() }`
2. Schedule a timeout function at `TIMEOUT_INTERVAL` (10 minutes)
3. Patch the document with the `timeoutFnId`

**REQ-SID-3**: Stream IDs must be passed to `addMessages` via `finishStreamId` for atomic stream finish + message persistence (prevents UI flicker from separate mutations).

### 5.2 Client-Side Stream ID Management

**REQ-SID-4**: React hooks must track multiple concurrent streams per thread:
- `useDeltaStreams` returns `Array<{ streamMessage: StreamMessage; deltas: StreamDelta[] }>`
- Each stream accumulates deltas independently
- Streams are sorted by `[order, stepOrder]` for display

**REQ-SID-5**: When a thread changes (`threadId` differs from previous render):
- Clear all accumulated delta streams (`state.deltaStreams = undefined`)
- Reset all cursors (`setCursors({})`)
- Reset `startOrder`

**REQ-SID-6**: Stream identity in UIMessages uses the convention `id: "stream:{streamId}"` to distinguish streaming messages from persisted messages.

### 5.3 Heartbeat & Timeout

**REQ-SID-7**: Heartbeat behavior:
- Triggered on every `addDelta` call
- Debounced: only writes if >2.5 minutes since last heartbeat (`TIMEOUT_INTERVAL / 4`)
- Updates `state.lastHeartbeat` and reschedules the timeout function

**REQ-SID-8**: Timeout behavior:
- After 10 minutes of inactivity, `timeoutStream` internal mutation fires
- Checks if `lastHeartbeat + TIMEOUT_INTERVAL < Date.now()`
- If expired: aborts the stream with reason `"timeout"`
- If not expired: reschedules for the remaining time

**REQ-SID-9**: Cleanup behavior:
- `finish()` schedules `deleteStream` after `DELETE_STREAM_DELAY` (5 minutes)
- `deleteStream` removes the `streamingMessages` document and all associated `streamDeltas`
- 5-minute delay allows clients to fetch final deltas before cleanup

---

## 6. Backwards Compatibility Requirements

### 6.1 Transport Compatibility

**REQ-BC-1**: The existing WebSocket/reactive-query streaming path must remain the default and primary transport. HTTP streaming is additive, not a replacement.

**REQ-BC-2**: All existing public APIs must remain unchanged:
- `syncStreams()` function signature and return type (`SyncStreamsReturnValue`)
- `listStreams()` function signature
- `abortStream()` function signature
- `vStreamMessagesReturnValue` validator

**REQ-BC-3**: The `StreamArgs` union type must be extended (not replaced) to support HTTP streaming parameters:
```typescript
// Existing (preserved):
type StreamArgs =
  | { kind: "list"; startOrder: number }
  | { kind: "deltas"; cursors: Array<{ streamId: string; cursor: number }> }
// New (additive):
  | { kind: "http"; streamId: string; cursor?: number }
```

### 6.2 Data Format Compatibility

**REQ-BC-4**: Both `UIMessageChunk` and `TextStreamPart` delta formats must be supported in perpetuity. The `format` field on `streamingMessages` is `v.optional(...)`, so streams created before format tracking was added (format = `undefined`) must default to `TextStreamPart` behavior.

**REQ-BC-5**: Forward compatibility for new `TextStreamPart` types from future AI SDK versions must be maintained via the `default` case in `updateFromTextStreamParts` (`src/deltas.ts:520-527`):
```typescript
default: {
  console.warn(`Received unexpected part: ${JSON.stringify(part)}`);
  break;
}
```

**REQ-BC-6**: The `readUIMessageStream` error suppression for `"no tool invocation found"` must be preserved (`src/deltas.ts:77-81`). This handles tool approval continuation streams that have `tool-result` without the original `tool-call`.

### 6.3 React Hook Compatibility

**REQ-BC-7**: Existing React hooks must not change behavior:
- `useThreadMessages` — paginated messages + streaming
- `useUIMessages` — UIMessage-first with metadata
- `useSmoothText` — animated text rendering

**REQ-BC-8**: New HTTP-streaming React hooks (if any) must be additive exports from `@convex-dev/agent/react`, not replacements.

### 6.4 Schema Compatibility

**REQ-BC-9**: No breaking changes to the component schema tables:
- `streamingMessages` — no field removals or type changes
- `streamDeltas` — no field removals or type changes
- Indexes must not be dropped (can add new ones)

**REQ-BC-10**: The `vStreamDelta` and `vStreamMessage` validators must remain structurally compatible. New optional fields may be added but existing fields must not change type or be removed.

### 6.5 Export Surface Compatibility

**REQ-BC-11**: All four export surfaces must remain stable:
- `@convex-dev/agent` — main exports
- `@convex-dev/agent/react` — React hooks
- `@convex-dev/agent/validators` — Convex validators
- `@convex-dev/agent/test` — testing utilities

HTTP streaming additions should be exported from the main surface or a new `@convex-dev/agent/http` surface (not mixed into existing surfaces that would break tree-shaking).

---

## 7. Non-Functional Requirements

**REQ-NF-1**: HTTP streaming latency must not exceed the WebSocket path latency by more than 100ms for equivalent payload sizes.

**REQ-NF-2**: HTTP streaming must support concurrent streams per thread (matching current behavior of up to 100 active streams per thread, per the `list` query's `.take(100)`).

**REQ-NF-3**: HTTP streaming must gracefully handle client disconnection without leaving orphaned streams (existing heartbeat/timeout mechanism applies).

**REQ-NF-4**: Delta writes must remain throttled at the configured `throttleMs` regardless of transport, to avoid excessive database writes.

---

## 8. Open Questions

1. **SSE vs NDJSON**: Should the HTTP transport use SSE (native browser support, automatic reconnection) or NDJSON (simpler, works with `fetch` + `ReadableStream`)?

2. **Authentication**: How should HTTP streaming endpoints authenticate? Convex actions have auth context, but raw HTTP endpoints may need token-based auth.

3. **Multi-stream HTTP**: Should a single HTTP connection support multiplexed streams (like the current WebSocket path with multi-cursor queries), or should each HTTP connection follow a single stream?

4. **Convex HTTP actions**: Should HTTP streaming be implemented as Convex HTTP actions (which have a 2-minute timeout and limited streaming support), or as a separate server/proxy?

5. **Atomic finish over HTTP**: The current `finishStreamId` pattern enables atomic stream finish + message save. How should this translate to the HTTP transport where the client may not be the writer?
