/**
 * Full Streaming Demo UI
 *
 * Demonstrates ALL streaming patterns with a comprehensive UI:
 *
 * - Async delta streaming with real-time message updates
 * - HTTP streaming via fetch with text decoding
 * - Stream lifecycle visualization (streaming / finished / aborted)
 * - Abort in-progress streams
 * - Stream inspector panel showing active/finished/aborted streams
 * - Smooth text animation via useSmoothText
 * - Optimistic message sending
 * - Tool approval flow (approve/deny buttons, auto-continuation)
 */
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  optimisticallySendMessage,
  useHttpStream,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useDemoThread } from "@/hooks/use-demo-thread";
import type { ToolUIPart } from "ai";

type StreamMode = "delta" | "http" | "oneshot";

export default function StreamingDemo() {
  const { threadId, resetThread } = useDemoThread("Streaming Demo");

  return (
    <>
      <header className="sticky top-0 h-16 z-10 bg-white/80 backdrop-blur-sm p-4 flex justify-between items-center border-b">
        <h1 className="text-xl font-semibold accent-text">
          Full Streaming Demo
        </h1>
      </header>
      <div className="h-[calc(100vh-8rem)] flex bg-gray-50">
        {threadId ? (
          <DemoApp threadId={threadId} reset={() => void resetThread()} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Loading...
          </div>
        )}
      </div>
    </>
  );
}

function DemoApp({
  threadId,
  reset,
}: {
  threadId: string;
  reset: () => void;
}) {
  const [streamMode, setStreamMode] = useState<StreamMode>("delta");

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <ModeSelector mode={streamMode} onChange={setStreamMode} />
        <ChatPanel threadId={threadId} mode={streamMode} reset={reset} />
      </div>

      {/* Right: Stream Inspector */}
      <div className="w-80 border-l bg-white overflow-y-auto">
        <StreamInspector threadId={threadId} />
      </div>
    </div>
  );
}

// ============================================================================
// Mode Selector
// ============================================================================

function ModeSelector({
  mode,
  onChange,
}: {
  mode: StreamMode;
  onChange: (m: StreamMode) => void;
}) {
  const modes: { value: StreamMode; label: string; desc: string }[] = [
    {
      value: "delta",
      label: "Delta Streaming",
      desc: "Async mutation + action with delta persistence (recommended)",
    },
    {
      value: "http",
      label: "HTTP Streaming",
      desc: "Direct text stream over HTTP response",
    },
    {
      value: "oneshot",
      label: "One-Shot",
      desc: "Single action call with delta persistence",
    },
  ];

  return (
    <div className="flex gap-2 p-3 bg-gray-100 border-b">
      {modes.map((m) => (
        <button
          key={m.value}
          onClick={() => onChange(m.value)}
          className={cn(
            "px-3 py-1.5 rounded text-sm font-medium transition",
            mode === m.value
              ? "bg-indigo-600 text-white"
              : "bg-white text-gray-700 hover:bg-gray-200",
          )}
          title={m.desc}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Chat Panel
// ============================================================================

function ChatPanel({
  threadId,
  mode,
  reset,
}: {
  threadId: string;
  mode: StreamMode;
  reset: () => void;
}) {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
  if (!convexUrl.endsWith(".cloud")) {
    console.warn("Unexpected Convex URL format; HTTP streaming may not work:", convexUrl);
  }
  const httpUrl = convexUrl.replace(/\.cloud$/, ".site");

  const httpStream = useHttpStream({ url: `${httpUrl}/streamTextDemo` });

  const {
    results: messages,
    status,
    loadMore,
  } = useUIMessages(
    api.chat.streamingDemo.listThreadMessages,
    { threadId },
    {
      initialNumItems: 20,
      stream: true,
      skipStreamIds: httpStream.streamId ? [httpStream.streamId] : [],
    },
  );

  const sendDelta = useMutation(
    api.chat.streamingDemo.sendMessage,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.streamingDemo.listThreadMessages),
  );
  const sendOneShot = useAction(api.chat.streamingDemo.streamOneShot);
  const abortByOrder = useMutation(
    api.chat.streamingDemo.abortStreamByOrder,
  );

  // Tool approval mutations
  const submitApproval = useMutation(api.chat.streamingDemo.submitApproval);
  const triggerContinuation = useMutation(api.chat.streamingDemo.triggerContinuation);

  // Track the last approval messageId so we can use it for continuation.
  const lastApprovalMessageIdRef = useRef<string | null>(null);
  // Track whether we've already triggered continuation for this batch.
  const continuationTriggeredRef = useRef(false);
  // Track the mode used when the request was sent, so continuation uses the same mode.
  const requestModeRef = useRef<StreamMode>(mode);

  const hasPendingApprovals = messages.some((m) =>
    m.parts.some(
      (p) => p.type.startsWith("tool-") && (p as ToolUIPart).state === "approval-requested",
    ),
  );

  // When all approvals are resolved (hasPendingApprovals goes false)
  // and we have a saved messageId, trigger continuation.
  // In HTTP mode, continuation also goes over HTTP. Otherwise, delta streaming.
  useEffect(() => {
    if (
      !hasPendingApprovals &&
      lastApprovalMessageIdRef.current &&
      !continuationTriggeredRef.current
    ) {
      continuationTriggeredRef.current = true;
      const messageId = lastApprovalMessageIdRef.current;
      lastApprovalMessageIdRef.current = null;
      if (requestModeRef.current === "http") {
        void httpStream.send({ threadId, promptMessageId: messageId });
      } else {
        void triggerContinuation({
          threadId,
          lastApprovalMessageId: messageId,
        });
      }
    }
    if (hasPendingApprovals) {
      continuationTriggeredRef.current = false;
    }
  }, [hasPendingApprovals, threadId, triggerContinuation, httpStream]);

  async function handleApproval(args: {
    threadId: string;
    approvalId: string;
    approved: boolean;
    reason?: string;
  }) {
    const { messageId } = await submitApproval(args);
    lastApprovalMessageIdRef.current = messageId;
  }

  const [prompt, setPrompt] = useState("Delete the file important.txt");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const httpText = httpStream.text;
  const httpStreaming = httpStream.isStreaming;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, httpText, scrollToBottom]);

  const isStreaming = messages.some((m) => m.status === "streaming");

  async function handleSend() {
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");
    requestModeRef.current = mode;

    if (mode === "delta") {
      await sendDelta({ threadId, prompt: text });
    } else if (mode === "oneshot") {
      // Don't await — the action runs server-side while deltas stream
      // to the client via reactive queries.
      sendOneShot({ threadId, prompt: text }).catch((e) =>
        console.error("oneshot error:", e),
      );
    } else if (mode === "http") {
      await httpStream.send({ threadId, prompt: text });
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length > 0 || httpText ? (
          <div className="flex flex-col gap-3 max-w-3xl mx-auto">
            {status === "CanLoadMore" && (
              <button
                className="self-center text-sm text-indigo-600 hover:underline"
                onClick={() => loadMore(10)}
              >
                Load more
              </button>
            )}
            {messages
              .filter(
                (m) =>
                  // While HTTP streaming, hide the pending assistant message —
                  // its content is shown in the HTTP stream bubble instead.
                  !(httpStreaming && httpText && m.role === "assistant" && m.status === "pending"),
              )
              .map((m) => (
                <MessageBubble
                  key={m.key}
                  message={m}
                  threadId={threadId}
                  onApproval={handleApproval}
                />
              ))}
            {httpStreaming && httpText && (() => {
              // Grab tool parts from the pending assistant message
              const pending = messages.find(
                (m) => m.role === "assistant" && m.status === "pending",
              );
              const toolParts = pending?.parts.filter((p) =>
                p.type.startsWith("tool-"),
              ) ?? [];
              return (
                <div className="flex justify-start">
                  <div
                    className={cn(
                      "rounded-lg px-4 py-2 max-w-lg whitespace-pre-wrap shadow-sm",
                      httpStreaming
                        ? "bg-green-100 text-gray-800"
                        : "bg-gray-200 text-gray-800",
                    )}
                  >
                    <span className="text-xs text-gray-400 block mb-1">
                      [HTTP stream{httpStreaming ? " - live" : " - done"}]
                    </span>
                    {toolParts.map((p: any) => (
                      <div
                        key={p.toolCallId}
                        className="text-xs bg-gray-100 rounded p-1.5 my-1 font-mono"
                      >
                        <span className="text-indigo-600">{p.type}</span>
                        {p.state && (
                          <span className="text-gray-400 ml-1">({p.state})</span>
                        )}
                        {p.output && (
                          <div className="text-gray-600 mt-0.5 truncate">
                            {typeof p.output === "string"
                              ? p.output
                              : JSON.stringify(p.output)}
                          </div>
                        )}
                      </div>
                    ))}
                    <div>{httpText}</div>
                  </div>
                </div>
              );
            })()}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Pick a streaming mode above and start chatting.
          </div>
        )}
      </div>

      <div className="border-t bg-white p-4">
        <form
          className="flex gap-2 items-center max-w-3xl mx-auto"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder={hasPendingApprovals ? "Respond to pending approvals first..." : "Type a message..."}
            disabled={hasPendingApprovals}
          />
          {isStreaming || httpStreaming ? (
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition font-medium"
              onClick={() => {
                if (httpStreaming) {
                  httpStream.abort();
                }
                const streaming = messages.find(
                  (m) => m.status === "streaming",
                );
                if (streaming) {
                  void abortByOrder({ threadId, order: streaming.order });
                }
              }}
            >
              Abort
            </button>
          ) : (
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition font-semibold disabled:opacity-50"
              disabled={!prompt.trim() || hasPendingApprovals}
            >
              Send
            </button>
          )}
          <button
            type="button"
            className="px-3 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition text-sm"
            onClick={() => {
              httpStream.abort();
              lastApprovalMessageIdRef.current = null;
              continuationTriggeredRef.current = false;
              reset();
            }}
          >
            Reset
          </button>
        </form>
        <div className="max-w-3xl mx-auto mt-2 text-xs text-gray-400">
          Mode:{" "}
          <strong>
            {mode === "delta"
              ? "Async Delta Streaming"
              : mode === "http"
                ? "HTTP Streaming"
                : "One-Shot Streaming"}
          </strong>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Message Bubble
// ============================================================================

function MessageBubble({
  message,
  threadId,
  onApproval,
}: {
  message: UIMessage;
  threadId: string;
  onApproval: (args: {
    threadId: string;
    approvalId: string;
    approved: boolean;
    reason?: string;
  }) => Promise<unknown>;
}) {
  const isUser = message.role === "user";
  const [visibleText] = useSmoothText(message.text, {
    startStreaming: message.status === "streaming",
  });
  const [reasoningText] = useSmoothText(
    message.parts
      .filter((p) => p.type === "reasoning")
      .map((p) => p.text)
      .join("\n") ?? "",
    { startStreaming: message.status === "streaming" },
  );

  const toolParts = message.parts.filter(
    (p): p is ToolUIPart => p.type.startsWith("tool-"),
  );

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "rounded-lg px-4 py-2 max-w-lg whitespace-pre-wrap shadow-sm",
          isUser ? "bg-indigo-100 text-indigo-900" : "bg-gray-200 text-gray-800",
          {
            "bg-green-100 border border-green-300":
              message.status === "streaming",
            "bg-red-100 border border-red-300": message.status === "failed",
          },
        )}
      >
        {/* Status badge */}
        {message.status !== "success" && message.role !== "user" && (
          <span
            className={cn("text-[10px] font-mono uppercase tracking-wide", {
              "text-green-600": message.status === "streaming",
              "text-orange-600": message.status === "pending",
              "text-red-600": message.status === "failed",
            })}
          >
            [{message.status}]
          </span>
        )}

        {/* Reasoning */}
        {reasoningText && (
          <div className="text-xs text-gray-500 italic mb-1 border-l-2 border-gray-300 pl-2">
            {reasoningText}
          </div>
        )}

        {/* Tool calls with approval UI */}
        {toolParts.map((tool) => (
          <ToolCallDisplay
            key={tool.toolCallId}
            tool={tool}
            threadId={threadId}
            onApproval={onApproval}
          />
        ))}

        {/* Main text */}
        <div>{visibleText || (isUser ? message.text : "...")}</div>
      </div>
    </div>
  );
}

// ============================================================================
// Tool Call Display with Approval UI
// ============================================================================

function ToolCallDisplay({
  tool,
  threadId,
  onApproval,
}: {
  tool: ToolUIPart;
  threadId: string;
  onApproval: (args: {
    threadId: string;
    approvalId: string;
    approved: boolean;
    reason?: string;
  }) => Promise<unknown>;
}) {
  const [denialReason, setDenialReason] = useState("");
  const [showReasonInput, setShowReasonInput] = useState(false);
  const toolName = tool.type.replace("tool-", "");
  const approvalId = getToolApprovalId(tool);
  const approvalReason = getToolApprovalReason(tool);

  return (
    <div className="mb-2 p-2 rounded bg-white/50 border border-gray-300 text-sm">
      <div className="font-mono text-xs text-gray-500 mb-1">
        {toolName}({JSON.stringify(tool.input)})
      </div>

      {tool.state === "approval-requested" && approvalId && (
        <div className="mt-2">
          <div className="text-amber-700 font-medium mb-2">
            Approval required
          </div>
          {showReasonInput ? (
            <div className="flex gap-2 items-center mb-2">
              <input
                type="text"
                value={denialReason}
                onChange={(e) => setDenialReason(e.target.value)}
                placeholder="Reason for denial..."
                className="flex-1 px-2 py-1 text-sm rounded border border-gray-300"
              />
              <button
                className="px-3 py-1 rounded bg-red-500 text-white text-sm hover:bg-red-600"
                onClick={() => {
                  void onApproval({
                    threadId,
                    approvalId,
                    approved: false,
                    reason: denialReason || undefined,
                  });
                }}
              >
                Deny
              </button>
              <button
                className="text-xs text-gray-500 hover:underline"
                onClick={() => setShowReasonInput(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                className="px-3 py-1 rounded bg-green-600 text-white text-sm hover:bg-green-700"
                onClick={() => {
                  void onApproval({
                    threadId,
                    approvalId,
                    approved: true,
                  });
                }}
              >
                Approve
              </button>
              <button
                className="px-3 py-1 rounded bg-red-500 text-white text-sm hover:bg-red-600"
                onClick={() => setShowReasonInput(true)}
              >
                Deny
              </button>
            </div>
          )}
        </div>
      )}

      {tool.state === "approval-responded" && (
        <div className="text-green-700 text-xs">Approved - executing...</div>
      )}

      {tool.state === "output-denied" && (
        <div className="text-red-600 text-xs">
          Denied
          {approvalReason && `: ${approvalReason}`}
        </div>
      )}

      {tool.state === "output-available" && (
        <div className="text-green-700 text-xs mt-1">
          Result: {JSON.stringify("output" in tool ? tool.output : undefined)}
        </div>
      )}

      {tool.state === "output-error" && (
        <div className="text-red-600 text-xs mt-1">
          Error: {"errorText" in tool ? tool.errorText : "Unknown error"}
        </div>
      )}

      {(tool.state === "input-available" || tool.state === "input-streaming") && (
        <div className="text-gray-500 text-xs">Processing...</div>
      )}
    </div>
  );
}

function getToolApprovalId(tool: ToolUIPart): string | undefined {
  if (tool.state !== "approval-requested" || !("approval" in tool)) {
    return undefined;
  }
  const approval = tool.approval as { id?: unknown } | undefined;
  return typeof approval?.id === "string" ? approval.id : undefined;
}

function getToolApprovalReason(tool: ToolUIPart): string | undefined {
  if (
    (tool.state !== "output-denied" && tool.state !== "approval-requested") ||
    !("approval" in tool)
  ) {
    return undefined;
  }
  const approval = tool.approval as { reason?: unknown } | undefined;
  return typeof approval?.reason === "string" ? approval.reason : undefined;
}

// ============================================================================
// Stream Inspector Panel
// ============================================================================

function StreamInspector({ threadId }: { threadId: string }) {
  const allStreams = useQuery(api.chat.streamingDemo.listAllStreams, {
    threadId,
  });

  const streaming = allStreams?.filter((s) => s.status === "streaming") ?? [];
  const finished = allStreams?.filter((s) => s.status === "finished") ?? [];
  const aborted = allStreams?.filter((s) => s.status === "aborted") ?? [];

  return (
    <div className="p-4">
      <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
        Stream Inspector
      </h2>

      <StreamSection
        label="Streaming"
        streams={streaming}
        color="green"
      />
      <StreamSection
        label="Finished"
        streams={finished}
        color="blue"
      />
      <StreamSection
        label="Aborted"
        streams={aborted}
        color="red"
      />

      {allStreams?.length === 0 && (
        <p className="text-xs text-gray-400 italic">
          No streams yet. Send a message to see stream lifecycle.
        </p>
      )}

      <div className="mt-6 p-3 bg-gray-50 rounded text-xs text-gray-500 space-y-2">
        <p className="font-semibold text-gray-700">How it works:</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>
            <strong>Delta Streaming:</strong> Mutation saves prompt, schedules
            an action. The action streams AI response and saves deltas to the
            database. Clients subscribe via reactive queries.
          </li>
          <li>
            <strong>HTTP Streaming:</strong> Direct text stream over HTTP.
            Response chunks are decoded by the browser. No database
            persistence of intermediate deltas.
          </li>
          <li>
            <strong>One-Shot:</strong> Single action call. Simpler but no
            optimistic updates.
          </li>
          <li>
            <strong>Abort:</strong> Transitions the stream to "aborted" state.
            Clients see the partial response with failed status.
          </li>
          <li>
            <strong>Fallback:</strong> When streaming finishes, the full
            message is saved to the database. The deduplication logic prefers
            finalized messages over streaming ones.
          </li>
        </ul>
      </div>
    </div>
  );
}

function StreamSection({
  label,
  streams,
  color,
}: {
  label: string;
  streams: any[];
  color: "green" | "blue" | "red";
}) {
  if (streams.length === 0) return null;

  const dotColors = {
    green: "bg-green-400",
    blue: "bg-blue-400",
    red: "bg-red-400",
  };
  const bgColors = {
    green: "bg-green-50 border-green-200",
    blue: "bg-blue-50 border-blue-200",
    red: "bg-red-50 border-red-200",
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className={cn("w-2 h-2 rounded-full", dotColors[color])} />
        <span className="text-xs font-semibold text-gray-600">
          {label} ({streams.length})
        </span>
      </div>
      <div className="space-y-1.5">
        {streams.map((s: any) => (
          <div
            key={s.streamId}
            className={cn(
              "text-[11px] font-mono p-2 rounded border",
              bgColors[color],
            )}
          >
            <div className="truncate text-gray-500">
              id: {s.streamId.slice(0, 12)}...
            </div>
            <div>
              order: {s.order}, step: {s.stepOrder}
            </div>
            {s.agentName && <div>agent: {s.agentName}</div>}
            {s.model && <div>model: {s.model}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
