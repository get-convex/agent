import type {
  HandleHttpStreamOptions,
  StreamConnection,
  StreamEvent,
  StreamReadResult,
  StreamStatus,
} from "@convex-dev/stream";
import { handleHttpStream } from "@convex-dev/stream";
import type { Value } from "convex/values";
import type {
  AgentError,
  AgentMessageInput,
  AgentMessagePart,
  AgentRunEvent,
  AgentStatus,
  AgentToolStatus,
  AgentUsage,
} from "../validators.js";

/** Ordered Agent run event returned by run event reads. @public */
export type AgentRunEventItem = StreamEvent<AgentRunEvent>;

/** A page of Agent run events plus cursor and lifecycle metadata. @public */
export type AgentRunEventRead = Omit<
  StreamReadResult<AgentRunEvent>,
  "status" | "error"
> & {
  /** Current Agent run lifecycle status. */
  status: AgentStatus;
  /** Current Stream transport lifecycle status for the run event log. */
  streamStatus: StreamStatus;
  /** Failure details when the Agent run or stream failed. */
  error?: AgentError;
};

/** Agent source content part surfaced by run state helpers. @public */
export type AgentSourcePart = Extract<AgentMessagePart, { type: "source" }>;

/** Agent file content part surfaced by run state helpers. @public */
export type AgentFilePart = Extract<AgentMessagePart, { type: "file" }>;

/** Tool-call state reconstructed from a run event stream. @public */
export type AgentRunStateToolCall = {
  /** Run id when the caller provided one while applying events. */
  runId?: string;
  /** Stable tool-call id from Agent run events. */
  toolCallId: string;
  /** Agent-native tool name when the call event has been observed. */
  name?: string;
  /** Validated tool input when the call event has been observed. */
  input?: Value;
  /** Current tool lifecycle state reconstructed from events. */
  status: AgentToolStatus;
  /** True when replay started after the original tool call event. */
  partial?: boolean;
  /** Approval id when this tool call requested approval. */
  approvalId?: string;
  /** Approval decision when resolved. */
  approved?: boolean;
  /** Optional denial or approval reason. */
  reason?: string;
  /** Tool output when execution succeeded. */
  output?: Value;
  /** Tool error when execution failed. */
  error?: AgentError;
  /** Stream event index where the call or approval was first observed. */
  requestedAt: number;
  /** Stream event index where the result or approval response was observed. */
  resolvedAt?: number;
};

/** Materialized view of an ordered Agent run event page. @public */
export type AgentRunState = {
  /** Best-known lifecycle status from events or explicit status updates. */
  status: AgentStatus;
  /** Message-like content assembled from Agent-native event payloads. */
  content: AgentMessagePart[];
  /** Concatenated text deltas and text message parts. */
  text: string;
  /** Concatenated reasoning deltas and reasoning message parts. */
  reasoning: string;
  /** Tool calls reconstructed from tool and approval events. */
  toolCalls: AgentRunStateToolCall[];
  /** Tool calls currently waiting for approval. */
  approvals: AgentRunStateToolCall[];
  /** Source parts emitted by the run. */
  sources: AgentSourcePart[];
  /** File parts emitted by the run. */
  files: AgentFilePart[];
  /** Final message events emitted by the run. */
  messages: AgentMessageInput[];
  /** Named adapter/app data events, grouped by name in event order. */
  data: Record<string, Value[]>;
  /** Final structured output when the model emits one. */
  output?: Value;
  /** Latest usage payload emitted by the run. */
  usage?: AgentUsage;
  /** Latest error emitted by the run. */
  error?: AgentError;
  /** True after a terminal `done` or `error` event. */
  done: boolean;
  /** Highest stream-global event index applied to this state. */
  lastIndex?: number;
  /** Latest opaque cursor reported by an HTTP stream or read loop. */
  cursor?: string;
};

/** Mutable handle for applying Agent run events to an {@link AgentRunState}. @public */
export type AgentRunStateHandle = {
  /** Current immutable state snapshot. */
  readonly value: AgentRunState;
  /** Apply one ordered run event. Duplicate or older indexes are ignored. */
  add(item: AgentRunEventItem): AgentRunState;
  /** Apply a page of ordered run events. Duplicate or older indexes are ignored. */
  addAll(items: readonly AgentRunEventItem[]): AgentRunState;
  /** Replace state and optionally initialize it from a page of events. */
  reset(items?: readonly AgentRunEventItem[]): AgentRunState;
  /** Record the latest opaque read cursor. */
  setCursor(cursor: string): AgentRunState;
  /** Record lifecycle status metadata returned by Stream HTTP/read APIs. */
  setStatus(status: AgentStatus, error?: AgentError): AgentRunState;
};

/** Options for handling a live Agent run stream over HTTP. @public */
export type HandleAgentRunStreamOptions = Omit<
  HandleHttpStreamOptions<AgentRunEvent>,
  "onEvents" | "onStatus" | "streamId"
> & {
  /** Optional Agent run id to add to the request query string. */
  runId?: string;
  /** Called with decoded Agent run events. */
  onEvents: (events: AgentRunEventItem[]) => void;
  /** Called when the HTTP stream sends terminal Stream lifecycle status. */
  onStatus?: (status: { status: StreamStatus; error?: AgentError }) => void;
};

function emptyState(): AgentRunState {
  return {
    status: "pending",
    content: [],
    text: "",
    reasoning: "",
    toolCalls: [],
    approvals: [],
    sources: [],
    files: [],
    messages: [],
    data: {},
    done: false,
  };
}

function cloneData(data: Record<string, Value[]>): Record<string, Value[]> {
  return Object.fromEntries(
    Object.entries(data).map(([key, values]) => [key, [...values]]),
  );
}

function cloneState(state: AgentRunState): AgentRunState {
  return {
    ...state,
    content: state.content.map((part) => ({ ...part }) as AgentMessagePart),
    toolCalls: state.toolCalls.map((toolCall) => ({ ...toolCall })),
    approvals: state.approvals.map((toolCall) => ({ ...toolCall })),
    sources: [...state.sources],
    files: [...state.files],
    messages: state.messages.map((message) => ({ ...message })),
    data: cloneData(state.data),
  };
}

function appendTextPart(state: AgentRunState, text: string) {
  state.text += text;
  const last = state.content.at(-1);
  if (last?.type === "text") {
    last.text += text;
  } else {
    state.content.push({ type: "text", text });
  }
}

function appendReasoningPart(state: AgentRunState, text: string) {
  state.reasoning += text;
  const last = state.content.at(-1);
  if (last?.type === "reasoning") {
    last.text += text;
  } else {
    state.content.push({ type: "reasoning", text });
  }
}

function setMessageContent(state: AgentRunState, content: AgentMessagePart[]) {
  state.content = [];
  state.text = "";
  state.reasoning = "";
  state.sources = [];
  state.files = [];
  for (const part of content) {
    state.content.push(part);
    if (part.type === "text") {
      state.text += part.text;
    } else if (part.type === "reasoning") {
      state.reasoning += part.text;
    } else if (part.type === "source") {
      state.sources.push(part);
    } else if (part.type === "file") {
      state.files.push(part);
    }
  }
}

function upsertToolCall(
  toolCalls: Map<string, AgentRunStateToolCall>,
  toolCallId: string,
  patch: Partial<AgentRunStateToolCall>,
) {
  const existing = toolCalls.get(toolCallId);
  toolCalls.set(toolCallId, {
    toolCallId,
    status: "pending",
    requestedAt: existing?.requestedAt ?? patch.requestedAt ?? 0,
    ...existing,
    ...patch,
  });
}

function normalizeLifecycle(state: AgentRunState, deriveRunning: boolean) {
  state.toolCalls = [...state.toolCalls];
  state.approvals = state.toolCalls.filter((call) => call.status === "waiting");
  if (state.done) {
    return;
  }
  if (state.approvals.length > 0) {
    state.status = "waiting";
  } else if (deriveRunning) {
    state.status = "running";
  }
}

function isDuplicateOrOlder(state: AgentRunState, item: AgentRunEventItem) {
  return state.lastIndex !== undefined && item.index <= state.lastIndex;
}

function assertNextIndex(state: AgentRunState, item: AgentRunEventItem) {
  if (state.lastIndex === undefined || isDuplicateOrOlder(state, item)) {
    return;
  }
  if (item.index !== state.lastIndex + 1) {
    throw new Error(
      `Agent run events must be applied in order without gaps: expected index ${
        state.lastIndex + 1
      }, received ${item.index}.`,
    );
  }
}

function applyEvent(
  state: AgentRunState,
  toolCalls: Map<string, AgentRunStateToolCall>,
  item: AgentRunEventItem,
) {
  if (isDuplicateOrOlder(state, item)) {
    return false;
  }
  assertNextIndex(state, item);
  state.lastIndex = item.index;

  const { event } = item;
  if (event.type === "text.delta") {
    appendTextPart(state, event.text);
  } else if (event.type === "reasoning.delta") {
    appendReasoningPart(state, event.text);
  } else if (event.type === "source") {
    const source = { ...event.source, type: "source" } as AgentSourcePart;
    state.sources.push(source);
    state.content.push(source);
  } else if (event.type === "file") {
    const file = { ...event.file, type: "file" } as AgentFilePart;
    state.files.push(file);
    state.content.push(file);
  } else if (event.type === "tool.call") {
    upsertToolCall(toolCalls, event.toolCallId, {
      name: event.name,
      input: event.input,
      status: "pending",
      partial: false,
      requestedAt: item.index,
    });
    state.content.push({
      type: "tool-call",
      toolCallId: event.toolCallId,
      name: event.name,
      input: event.input,
    });
  } else if (event.type === "tool.result") {
    const existing = toolCalls.get(event.toolCallId);
    upsertToolCall(toolCalls, event.toolCallId, {
      name: event.name ?? existing?.name,
      status: event.error ? "failed" : "success",
      partial: existing === undefined,
      output: event.output,
      error: event.error,
      requestedAt: existing?.requestedAt ?? item.index,
      resolvedAt: item.index,
    });
    state.content.push({
      type: "tool-result",
      toolCallId: event.toolCallId,
      name: event.name,
      output: event.output,
      error: event.error,
    });
  } else if (event.type === "approval.request") {
    upsertToolCall(toolCalls, event.toolCallId, {
      name: event.name,
      input: event.input,
      status: "waiting",
      partial: false,
      approvalId: event.approvalId,
      requestedAt: item.index,
    });
    state.content.push({
      type: "approval-request",
      approvalId: event.approvalId,
      toolCallId: event.toolCallId,
    });
  } else if (event.type === "approval.response") {
    const existing = toolCalls.get(event.toolCallId);
    upsertToolCall(toolCalls, event.toolCallId, {
      name: existing?.name,
      status: event.approved ? "pending" : "canceled",
      partial: existing === undefined,
      approvalId: event.approvalId,
      approved: event.approved,
      reason: event.reason,
      requestedAt: existing?.requestedAt ?? item.index,
      resolvedAt: item.index,
    });
    state.content.push({
      type: "approval-response",
      approvalId: event.approvalId,
      toolCallId: event.toolCallId,
      approved: event.approved,
      reason: event.reason,
    });
  } else if (event.type === "data") {
    state.data[event.name] = [...(state.data[event.name] ?? []), event.value];
  } else if (event.type === "output") {
    state.output = event.value;
  } else if (event.type === "usage") {
    state.usage = event.usage;
  } else if (event.type === "message") {
    state.messages.push(event.message);
    setMessageContent(state, event.message.message.content);
    state.usage = event.message.usage ?? state.usage;
    if (event.message.error) {
      state.error = { code: "message-error", message: event.message.error };
      state.status = "failed";
    }
  } else if (event.type === "error") {
    state.error = event.error;
    state.status = "failed";
    state.done = true;
  } else if (event.type === "done") {
    state.usage = event.usage ?? state.usage;
    state.status = "success";
    state.done = true;
  }

  state.toolCalls = [...toolCalls.values()];
  normalizeLifecycle(state, true);
  return true;
}

function validateOrderedPage(
  state: AgentRunState,
  items: readonly AgentRunEventItem[],
) {
  const appliedLast = state.lastIndex;
  let last = state.lastIndex;
  for (const item of items) {
    if (
      appliedLast !== undefined &&
      last === appliedLast &&
      item.index <= appliedLast
    ) {
      continue;
    }
    if (last !== undefined && item.index <= last) {
      throw new Error(
        `Agent run event page is out of order or has a gap: expected index ${
          last + 1
        }, received ${item.index}.`,
      );
    }
    if (last !== undefined && item.index !== last + 1) {
      throw new Error(
        `Agent run event page is out of order or has a gap: expected index ${
          last + 1
        }, received ${item.index}.`,
      );
    }
    last = item.index;
  }
}

/**
 * Create a state handle for Agent run event pages.
 *
 * @remarks
 * This helper is intentionally Agent-specific. It turns ordered
 * {@link AgentRunEventItem} values into the message parts, text, reasoning,
 * tool state, data events, and output that adapter packages need while keeping
 * Stream itself data-type agnostic.
 *
 * @public
 */
export function createAgentRunState(
  initialEvents: readonly AgentRunEventItem[] = [],
): AgentRunStateHandle {
  let current = emptyState();
  const toolCalls = new Map<string, AgentRunStateToolCall>();

  const handle: AgentRunStateHandle = {
    get value() {
      return current;
    },
    add(item) {
      if (isDuplicateOrOlder(current, item)) {
        return current;
      }
      assertNextIndex(current, item);
      const next = cloneState(current);
      if (applyEvent(next, toolCalls, item)) {
        current = next;
      }
      return current;
    },
    addAll(items) {
      validateOrderedPage(current, items);
      const next = cloneState(current);
      let changed = false;
      for (const item of items) {
        changed = applyEvent(next, toolCalls, item) || changed;
      }
      if (changed) {
        current = next;
      }
      return current;
    },
    reset(items = []) {
      current = emptyState();
      toolCalls.clear();
      return handle.addAll(items);
    },
    setCursor(cursor) {
      current = { ...current, cursor };
      return current;
    },
    setStatus(status, error) {
      const next = {
        ...current,
        status,
        error: error ?? current.error,
        done:
          current.done ||
          status === "success" ||
          status === "failed" ||
          status === "canceled",
      };
      normalizeLifecycle(next, false);
      current = next;
      return current;
    },
  };

  handle.addAll(initialEvents);
  return handle;
}

/**
 * Merge ordered Agent run events into an Agent run-state handle.
 *
 * @remarks
 * This helper is the framework-agnostic reducer primitive for React, Svelte,
 * Vercel, TanStack, and custom adapters. It intentionally works on
 * Agent-owned event payloads rather than Stream-specific UI state.
 *
 * @param state - Mutable run-state handle created by {@link createAgentRunState}.
 * @param events - Ordered run events to merge.
 * @returns The updated immutable run-state snapshot.
 *
 * @public
 */
export function mergeAgentRunEvents(
  state: AgentRunStateHandle,
  events: readonly AgentRunEventItem[],
): AgentRunState {
  return state.addAll(events);
}

/**
 * Handle a live Agent run stream served by `agent.http(...)`.
 *
 * @remarks
 * This is a typed wrapper around `@convex-dev/stream`'s
 * {@link handleHttpStream}. It preserves the same SSE cursor, retry, and
 * lifecycle behavior while exposing Agent-native event payloads.
 *
 * @public
 */
export function handleAgentRunStream(
  opts: HandleAgentRunStreamOptions,
): StreamConnection {
  const { runId, ...streamOptions } = opts;
  return handleHttpStream<AgentRunEvent>({
    ...streamOptions,
    url: addRunIdToUrl(streamOptions.url, runId),
  });
}

function addRunIdToUrl(url: string | URL, runId: string | undefined): string | URL {
  if (runId === undefined) {
    return url;
  }
  const text = url.toString();
  const base =
    typeof globalThis.location === "undefined"
      ? "http://localhost"
      : globalThis.location.href;
  const next = new URL(text, base);
  next.searchParams.set("runId", runId);
  return url instanceof URL ? next : next.toString();
}
