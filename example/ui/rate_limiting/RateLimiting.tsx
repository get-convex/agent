import { useMutation, useQuery } from "convex/react";
import { Toaster } from "../components/ui/toaster";
import { api } from "../../convex/_generated/api";
import {
  SmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useCallback, useEffect, useState, useRef, useReducer } from "react";
import { toast } from "../hooks/use-toast";
import { isRateLimitError } from "@convex-dev/rate-limiter";
import { useRateLimit } from "@convex-dev/rate-limiter/react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Monitor } from "../components/Monitor";

dayjs.extend(relativeTime);

function getThreadIdFromHash() {
  return window.location.hash.replace(/^#/, "") || undefined;
}

export default function Example() {
  const [question, setQuestion] = useState("What's 1+1?");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { status } = useRateLimit(api.rate_limiting.utils.getRateLimit, {
    getServerTimeMutation: api.rate_limiting.utils.getServerTime,
  });
  const [threadId, setThreadId] = useState<string | undefined>(
    typeof window !== "undefined" ? getThreadIdFromHash() : undefined,
  );
  const previousUsage = useQuery(
    api.rate_limiting.utils.getPreviousUsage,
    threadId ? { threadId } : "skip",
  );
  const estimatedUsage = previousUsage ?? 0 + question.length;
  const { status: tokenUsageStatus } = useRateLimit(
    api.rate_limiting.utils.getRateLimit,
    {
      getServerTimeMutation: api.rate_limiting.utils.getServerTime,
      name: "tokenUsagePerUser",
      count: estimatedUsage,
    },
  );
  const submitQuestion = useMutation(
    api.rate_limiting.rateLimiting.submitQuestion,
  );
  const messages = useUIMessages(
    api.chat.streaming.listThreadMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 10, stream: true },
  );
  const createThread = useMutation(api.threads.createNewThread);

  // Listen for hash changes
  useEffect(() => {
    function onHashChange() {
      setThreadId(getThreadIdFromHash());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.results]);

  const handleSubmitQuestion = useCallback(
    async (question: string) => {
      setQuestion("why?");
      const tId =
        threadId ?? (await createThread({ title: "Rate Limited Chat" }));
      if (!threadId) {
        setThreadId(tId);
        window.location.hash = tId;
      }
      await submitQuestion({ question, threadId: tId }).catch((e) => {
        if (isRateLimitError(e)) {
          // Ideally we never get here unless they're over token usage, since
          // we have the query on rate limit status. however there can be
          // network latency races.
          toast({
            title: "Rate limit exceeded",
            description: `Rate limit exceeded for ${e.data.name}.
              Try again after ${getRelativeTime(Date.now() + e.data.retryAfter)}`,
          });
          setQuestion((q) => q || question);
        } else {
          toast({
            title: "Failed to submit question",
            description: e.message,
          });
          setQuestion((q) => q || question);
        }
      });
    },
    [submitQuestion, threadId, createThread],
  );

  return (
    <>
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm p-4 flex justify-between items-center border-b">
        <h1 className="text-xl font-semibold accent-text">
          Rate Limiting Example
        </h1>
      </header>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        {/* Centered container */}
        <div className="flex max-w-6xl w-full h-[calc(100vh-120px)] gap-6">
          {/* Left side - Monitors (1/3 width, no scroll) */}
          <div className="w-1/3 space-y-4 flex-shrink-0">
            {/* Send Message Monitor */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-3 border-b border-gray-100">
                <h3 className="text-sm font-medium text-gray-700">
                  Send Message Rate Limit
                </h3>
                <p className="text-xs text-gray-500">
                  1 message per 5 seconds (capped at 2 at once)
                </p>
              </div>
              <div className="">
                <div className="w-full max-w-7xl mx-auto p-6 space-y-8 animate-fade-in">
                  <Monitor
                    key="sendMessage"
                    getRateLimitValueQuery={
                      api.rate_limiting.utils.getRateLimit
                    }
                    opts={{
                      getServerTimeMutation:
                        api.rate_limiting.utils.getServerTime,
                      name: "sendMessage",
                    }}
                    height="250px"
                  />
                </div>
              </div>
            </div>

            {/* Token Usage Monitor */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-3 border-b border-gray-100">
                <h3 className="text-sm font-medium text-gray-700">
                  Token Usage Rate Limit
                </h3>
                <p className="text-xs text-gray-500">
                  2k tokens per minute (capped at 10k at once)
                </p>
              </div>
              <div className="">
                <div className="w-full max-w-7xl mx-auto p-6 space-y-8 animate-fade-in">
                  <Monitor
                    getRateLimitValueQuery={
                      api.rate_limiting.utils.getRateLimit
                    }
                    opts={{
                      getServerTimeMutation:
                        api.rate_limiting.utils.getServerTime,
                      name: "tokenUsagePerUser",
                      count: previousUsage ?? 0 + question.length,
                    }}
                    height="250px"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right side - Chat interface (2/3 width with scrolling) */}
          <div className="w-2/3 flex flex-col bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
            {/* Chat header */}
            <div className="p-6 border-b border-gray-200 flex-shrink-0">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">
                  Rate Limited Chat
                </h2>
                <p className="text-gray-600 text-sm">
                  This demo shows rate limiting in action. You can send 1
                  message per 5 seconds and use up to 1000 tokens per minute.
                </p>
              </div>
            </div>

            {/* Chat Messages - Scrollable area */}
            <div className="flex-1 overflow-y-auto p-6">
              {messages.results?.length > 0 ? (
                <div className="flex flex-col gap-4 pb-4">
                  {messages.results.map((m) => (
                    <Message key={m.key} message={m} />
                  ))}
                  <div className="h-100" ref={messagesEndRef} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <p>Start a conversation by asking a question below!</p>
                </div>
              )}
            </div>

            {/* Chat Input - Fixed at bottom */}
            <div className="p-6 border-t border-gray-200 flex-shrink-0">
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSubmitQuestion(question);
                }}
              >
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-lg"
                  placeholder="Ask me anything..."
                />
                {status && !status.ok && (
                  <div className="text-xs text-gray-500 text-center">
                    <p>Message sending rate limit exceeded.</p>
                    <p>
                      Try again after <Countdown ts={status.retryAt} />
                    </p>
                  </div>
                )}
                {tokenUsageStatus && !tokenUsageStatus.ok && (
                  <div className="text-xs text-gray-500 text-center bg-red-100 p-2 rounded-lg">
                    <p>Token usage limit exceeded.</p>
                    <p>
                      Try again after{" "}
                      <Countdown ts={tokenUsageStatus.retryAt} />
                    </p>
                  </div>
                )}
                <p className="text-xs text-gray-400">
                  Previous usage: {previousUsage ?? 0} tokens Estimated usage:{" "}
                  {estimatedUsage} tokens
                </p>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition font-semibold text-lg disabled:opacity-50"
                    disabled={
                      !question.trim() ||
                      !status?.ok ||
                      (tokenUsageStatus && !tokenUsageStatus.ok)
                    }
                  >
                    Send
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition font-semibold text-lg disabled:opacity-50"
                    disabled={!question.trim()}
                  >
                    Force Send
                  </button>
                  {messages.results?.length > 0 && (
                    <button
                      className="px-4 py-3 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition font-medium"
                      onClick={() => {
                        setThreadId(undefined);
                        setQuestion("What is the meaning of life?");
                        window.location.hash = "";
                      }}
                      type="button"
                    >
                      Start over
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
      <Toaster />
    </>
  );
}

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} w-full`}>
      <div
        className={`rounded-2xl px-5 py-3 max-w-[75%] whitespace-pre-wrap shadow-md text-base break-words border ${
          isUser
            ? "bg-blue-100 text-blue-900 border-blue-200"
            : "bg-gray-100 text-gray-800 border-gray-200"
        }`}
      >
        {message.parts.map((part, i) => {
          const key = message.key + i;
          switch (part.type) {
            case "text":
              return (
                <div key={key}>
                  <SmoothText text={part.text} />
                </div>
              );
            case "file":
              if (part.mediaType?.startsWith("image/")) {
                return (
                  <img
                    key={key}
                    src={part.url}
                    className="max-h-40 rounded-lg mt-2 border border-gray-300 shadow"
                  />
                );
              }
              return (
                <a
                  key={key}
                  href={part.url}
                  className="text-blue-600 underline"
                >
                  {"📎"}File
                </a>
              );
            case "reasoning":
              return (
                <div key={key} className="italic text-gray-500">
                  {part.text}
                </div>
              );
            case "dynamic-tool":
              return (
                <div key={key} className="text-xs text-gray-400">
                  {part.toolName}
                </div>
              );
            case "source-url":
              return (
                <a
                  key={key}
                  href={part.url}
                  className="text-blue-500 underline"
                >
                  {part.title ?? part.url}
                </a>
              );
            case "source-document":
              return (
                <div key={key} className="text-xs text-gray-400">
                  {part.title}
                </div>
              );
            default:
              if (part.type.startsWith("tool-")) {
                return (
                  <div key={key} className="text-xs text-gray-400">
                    {part.type.slice("tool-".length)}
                  </div>
                );
              }
          }
        })}
      </div>
    </div>
  );
}

function getRelativeTime(timestamp: number | null) {
  if (!timestamp) return null;

  const now = Date.now();
  const diffSeconds = Math.ceil((timestamp - now) / 1000);

  // For short durations, show exact seconds
  if (diffSeconds <= 60) {
    if (diffSeconds <= 1) return "in the flashest of flashes";
    return `in ${diffSeconds} second${diffSeconds > 1 ? "s" : ""}`;
  }

  // For longer durations, use dayjs relative time
  return dayjs(timestamp).fromNow();
}

function Countdown({ ts }: { ts: number }) {
  const [, refresh] = useReducer((i) => i + 1, 0);
  useEffect(() => {
    const interval = setInterval(() => {
      refresh();
    }, 1000);
    return () => clearInterval(interval);
  }, [ts]);
  return <>{getRelativeTime(ts)}</>;
}
