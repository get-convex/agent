import { useAction, useMutation, useQuery } from "convex/react";
import { Toaster } from "../components/ui/toaster";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "../../convex/_generated/api";
import {
  optimisticallySendMessage,
  toUIMessages,
  useThreadMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useState, useEffect } from "react";
import { cn } from "../lib/utils";
import { useDemoThread } from "@/hooks/use-demo-thread";

export default function TracedChat() {
  const {
    threadId,
    resetThread: newThread,
    setThreadId,
  } = useDemoThread("LangFuse Traced Chat");

  // Check if LangFuse is configured
  const checkConfig = useAction(api.tracing.tracedChat.checkLangfuseConfig);
  const [langfuseConfig, setLangfuseConfig] = useState<{
    configured: boolean;
    baseUrl: string;
  } | null>(null);

  useEffect(() => {
    checkConfig().then(setLangfuseConfig);
  }, [checkConfig]);

  // Fetch thread title if threadId exists
  const threadDetails = useQuery(
    api.threads.getThreadDetails,
    threadId ? { threadId } : "skip"
  );

  // Fetch all threads
  const threads = usePaginatedQuery(
    api.threads.listThreads,
    {},
    { initialNumItems: 20 }
  );

  return (
    <div className="h-full flex flex-col">
      <header className="bg-white/80 backdrop-blur-sm p-4 flex justify-between items-center border-b">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold accent-text">
            LangFuse Traced Chat
          </h1>
          {threadId && threadDetails && threadDetails.title && (
            <span
              className="text-gray-500 text-base font-normal truncate max-w-xs"
              title={threadDetails.title}
            >
              &mdash; {threadDetails.title}
            </span>
          )}
        </div>
      </header>
      <div className="h-full flex flex-row bg-gray-50 flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r flex flex-col h-full min-h-0">
          <div className="p-4 border-b font-semibold text-lg">Threads</div>

          {/* LangFuse status banner */}
          <div
            className={cn(
              "mx-4 mt-4 p-3 rounded-lg text-sm",
              langfuseConfig?.configured
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-yellow-50 text-yellow-800 border border-yellow-200"
            )}
          >
            {langfuseConfig === null ? (
              <span>Checking LangFuse config...</span>
            ) : langfuseConfig.configured ? (
              <>
                <div className="font-medium">LangFuse Connected</div>
                <a
                  href={langfuseConfig.baseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-600 hover:underline text-xs"
                >
                  View traces &rarr;
                </a>
              </>
            ) : (
              <>
                <div className="font-medium">LangFuse Not Configured</div>
                <div className="text-xs mt-1">
                  Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY environment
                  variables to enable tracing.
                </div>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {threads.results.length === 0 && (
              <div className="p-4 text-gray-400 text-sm">No threads yet.</div>
            )}
            <ul>
              {threads.results.map((thread) => (
                <li key={thread._id}>
                  <button
                    className={cn(
                      "w-full text-left px-4 py-2 hover:bg-purple-50 transition flex items-center gap-2",
                      threadId === thread._id &&
                        "bg-purple-100 text-purple-900 font-semibold"
                    )}
                    onClick={() => {
                      window.location.hash = thread._id;
                      setThreadId(thread._id);
                    }}
                  >
                    <span className="truncate max-w-[10rem]">
                      {thread.title || "Untitled thread"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="px-4 py-2">
            <button
              onClick={() => void newThread()}
              className="w-full flex justify-center items-center gap-2 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              type="button"
            >
              <span className="text-lg">+</span>
              <span>New Thread</span>
            </button>
          </div>
        </aside>
        {/* Main chat area */}
        <main className="flex-1 flex flex-col items-center justify-center p-8 h-full min-h-0">
          {threadId ? (
            <Chat threadId={threadId} />
          ) : (
            <div className="text-center text-gray-500">Loading...</div>
          )}
        </main>
        <Toaster />
      </div>
    </div>
  );
}

function Chat({ threadId }: { threadId: string }) {
  const messages = useThreadMessages(
    api.tracing.tracedChat.listThreadMessages,
    { threadId },
    { initialNumItems: 10 }
  );
  const sendMessage = useMutation(
    api.tracing.tracedChat.sendMessage
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.tracing.tracedChat.listThreadMessages)
  );
  const [prompt, setPrompt] = useState("Hello! How are you?");

  function onSendClicked() {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === "") return;
    void sendMessage({ threadId, prompt: trimmedPrompt }).catch(() =>
      setPrompt(prompt)
    );
    setPrompt("");
  }

  return (
    <>
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-lg p-6 flex flex-col gap-6 h-full min-h-0 justify-end">
        {/* Info banner about tracing */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-purple-800">
          <div className="font-medium mb-1">Observability with LangFuse</div>
          <p className="text-purple-700">
            Every message in this chat is traced to LangFuse. You can view the
            traces in your LangFuse dashboard to see request/response details,
            token usage, and latency metrics.
          </p>
        </div>

        {messages.status !== "Exhausted" && messages.results?.length > 0 && (
          <div className="flex justify-center">
            <button
              className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition font-semibold disabled:opacity-50"
              onClick={() => messages.loadMore(10)}
              disabled={messages.status !== "CanLoadMore"}
            >
              Load More
            </button>
          </div>
        )}
        {messages.results?.length > 0 && (
          <div className="flex flex-col gap-4 overflow-y-auto mb-4 flex-1 min-h-0">
            {toUIMessages(messages.results ?? []).map((m) => (
              <Message key={m.key} message={m} />
            ))}
          </div>
        )}
        <form
          className="flex gap-2 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            onSendClicked();
          }}
        >
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-gray-50"
            placeholder="Ask me anything..."
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition font-semibold disabled:opacity-50"
            disabled={!prompt.trim()}
          >
            Send
          </button>
        </form>
      </div>
    </>
  );
}

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`rounded-lg px-4 py-2 max-w-lg whitespace-pre-wrap shadow-sm ${
          isUser
            ? "bg-purple-100 text-purple-900"
            : "bg-gray-200 text-gray-800"
        }`}
      >
        {message.text || "..."}
      </div>
    </div>
  );
}
