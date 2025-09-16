import { useMutation } from "convex/react";
import { Toaster } from "../components/ui/toaster";
import { api } from "../../convex/_generated/api";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useDemoThread } from "@/hooks/use-demo-thread";
import { ToolUIPart } from "ai";

export default function ChatStreaming() {
  const { threadId, resetThread } = useDemoThread("Streaming Chat Example");

  return (
    <>
      <header className="sticky top-0 h-16 z-10 bg-white/80 backdrop-blur-sm p-4 flex justify-between items-center border-b">
        <h1 className="text-xl font-semibold accent-text">
          Streaming Chat Example
        </h1>
      </header>
      <div className="h-[calc(100vh-8rem)] flex flex-col bg-gray-50">
        {threadId ? (
          <Story threadId={threadId} reset={() => void resetThread()} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Loading...
          </div>
        )}
        <Toaster />
      </div>
    </>
  );
}

function Story({ threadId, reset }: { threadId: string; reset: () => void }) {
  // Loads the messages as UIMessages (where all tool calls and assistant
  // responses are parts in one message). See below for other options.
  const {
    results: messages,
    status,
    loadMore,
  } = useUIMessages(
    api.chat.streaming.listThreadMessages,
    { threadId },
    { initialNumItems: 10, stream: true },
  );
  // If you don't want to use UIMessages, you can use this hook:
  // (note: you'll need to return MessageDoc from listThreadMessages)
  /*
  const { results } = useThreadMessages(
    api.chat.streaming.listThreadMessages,
    { threadId },
    { initialNumItems: 10, stream: true },
  );
  const messages = toUIMessages(results ?? []);
  */
  // If you only want to show streaming messages, you can use this hook:
  /*
  const messages =
    useStreamingUIMessages(api.chat.streaming.listThreadMessages, {
      threadId,
      paginationOpts: { numItems: 10, cursor: null },
    }) ?? [];
  */

  const sendMessage = useMutation(
    api.chat.streaming.initiateAsyncStreaming,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.streaming.listThreadMessages),
  );
  const abortStreamByOrder = useMutation(
    api.chat.streamAbort.abortStreamByOrder,
  );
  const [prompt, setPrompt] = useState("What is the best flavor of ice cream?");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  function onSendClicked() {
    if (prompt.trim() === "") return;
    void sendMessage({ threadId, prompt }).catch(() => setPrompt(prompt));
    setPrompt("Continue the story...");
  }

  return (
    <>
      <div className="h-full flex flex-col max-w-4xl mx-auto w-full">
        {/* Messages area - scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length > 0 ? (
            <div className="flex flex-col gap-4 whitespace-pre">
              {status === "CanLoadMore" && (
                <button onClick={() => loadMore(4)}>Load more</button>
              )}
              {messages.map((m) => (
                <Message key={m.key} message={m} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Start a conversation...
            </div>
          )}
        </div>

        {/* Fixed input area at bottom */}
        <div className="border-t bg-white p-6">
          <form
            className="flex gap-2 items-center max-w-2xl mx-auto"
            onSubmit={(e) => {
              e.preventDefault();
              onSendClicked();
            }}
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
              placeholder={
                messages.length > 0
                  ? "Continue the story..."
                  : "Tell me a story..."
              }
            />
            {messages.find((m) => m.status === "streaming") ? (
              <button
                className="px-4 py-2 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition font-medium self-end"
                onClick={() => {
                  const order =
                    messages.find((m) => m.status === "streaming")?.order ?? 0;
                  void abortStreamByOrder({ threadId, order });
                }}
                type="button"
              >
                Abort
              </button>
            ) : (
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition font-semibold disabled:opacity-50"
                disabled={!prompt.trim()}
              >
                Send
              </button>
            )}
            {messages.length > 0 && (
              <button
                className="px-4 py-2 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition font-medium self-end"
                onClick={() => {
                  reset();
                  setPrompt("Tell me a story");
                }}
                type="button"
              >
                Reset
              </button>
            )}
          </form>
        </div>
      </div>
    </>
  );
}

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const [visibleText] = useSmoothText(message.text, {
    // This tells the hook that it's ok to start streaming immediately.
    // If this was always passed as true, messages that are already done would
    // also stream in.
    // IF this was always passed as false (default), then the streaming message
    // wouldn't start streaming until the second chunk was received.
    startStreaming: message.status === "streaming",
  });
  const [reasoningText] = useSmoothText(
    message.parts
      .filter((p) => p.type === "reasoning")
      .map((p) => p.text)
      .join("\n") ?? "",
    {
      startStreaming: message.status === "streaming",
    },
  );
  const nameToolCalls = message.parts.filter(
    (p): p is ToolUIPart => p.type === "tool-getCharacterNames",
  );
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "rounded-lg px-4 py-2 max-w-lg whitespace-pre-wrap shadow-sm",
          isUser ? "bg-blue-100 text-blue-900" : "bg-gray-200 text-gray-800",
          {
            "bg-green-100": message.status === "streaming",
            "bg-red-100": message.status === "failed",
          },
        )}
      >
        {reasoningText && (
          <div className="text-xs text-gray-500">💭{reasoningText}</div>
        )}
        {nameToolCalls.map((p) => (
          <div key={p.toolCallId} className="text-xs text-gray-500">
            Names generated:{" "}
            {p.output ? (p.output as string[]).join(", ") : p.state}
            <br />
          </div>
        ))}
        {visibleText || "..."}
      </div>
    </div>
  );
}
