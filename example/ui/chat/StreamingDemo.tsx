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
 */
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useDemoThread } from "@/hooks/use-demo-thread";

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
  const {
    results: messages,
    status,
    loadMore,
  } = useUIMessages(
    api.chat.streamingDemo.listThreadMessages,
    { threadId },
    { initialNumItems: 20, stream: true },
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

  const [prompt, setPrompt] = useState("Hello! Tell me a joke.");
  const [httpText, setHttpText] = useState("");
  const [httpStreaming, setHttpStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, httpText, scrollToBottom]);

  // Clear the HTTP stream text once streaming ends. The final message is
  // saved to the DB during streaming (via onStepFinish), so by the time
  // the HTTP stream closes, the stored message is already in useUIMessages.
  useEffect(() => {
    if (httpText && !httpStreaming) {
      setHttpText("");
    }
  }, [httpText, httpStreaming]);

  const isStreaming = messages.some((m) => m.status === "streaming");

  async function handleSend() {
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");

    if (mode === "delta") {
      await sendDelta({ threadId, prompt: text });
    } else if (mode === "oneshot") {
      // Don't await — the action runs server-side while deltas stream
      // to the client via reactive queries.
      sendOneShot({ threadId, prompt: text }).catch((e) =>
        console.error("oneshot error:", e),
      );
    } else if (mode === "http") {
      await streamOverHttp(threadId, text, setHttpText, setHttpStreaming);
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
                  !(httpText && m.role === "assistant" && m.status === "pending"),
              )
              .map((m) => (
                <MessageBubble key={m.key} message={m} />
              ))}
            {httpText && (() => {
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
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50"
            placeholder="Type a message..."
          />
          {isStreaming || httpStreaming ? (
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition font-medium"
              onClick={() => {
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
              disabled={!prompt.trim()}
            >
              Send
            </button>
          )}
          <button
            type="button"
            className="px-3 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition text-sm"
            onClick={() => {
              setHttpText("");
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
// HTTP Streaming Helper
// ============================================================================

async function streamOverHttp(
  threadId: string,
  prompt: string,
  onText: (text: string) => void,
  onStreaming: (streaming: boolean) => void,
) {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
  // Derive the HTTP actions URL from the Convex deployment URL
  const httpUrl = convexUrl.replace(/\.cloud$/, ".site");
  onStreaming(true);
  onText("");

  try {
    const res = await fetch(`${httpUrl}/streamText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, prompt }),
    });

    if (!res.ok || !res.body) {
      onText(`Error: ${res.status} ${res.statusText}`);
      onStreaming(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      onText(accumulated);
    }
  } catch (err) {
    onText(`Stream error: ${err}`);
  } finally {
    onStreaming(false);
  }
}

// ============================================================================
// Message Bubble
// ============================================================================

function MessageBubble({ message }: { message: UIMessage }) {
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

  const toolParts = message.parts.filter((p) => p.type.startsWith("tool-"));

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

        {/* Tool calls */}
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

        {/* Main text */}
        <div>{visibleText || (isUser ? message.text : "...")}</div>
      </div>
    </div>
  );
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
