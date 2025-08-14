import { useState } from "react";
import { useMutation } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "../../convex/_generated/api";
import ReactMarkdown from "react-markdown";
import { useStreamingText, useThreadMessages } from "@convex-dev/agent/react";

export function WeatherFashion() {
  const [content, setContent] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const threads = usePaginatedQuery(
    api.threads.listThreads,
    {},
    { initialNumItems: 10 },
  );
  const messages = useThreadMessages(
    api.chat.basic.listThreadMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 10 },
  );
  // const getAdvice = useAction(api.workflows.chaining.getAdvice);
  const startWorkflow = useMutation(api.workflows.chaining.startWorkflow);
  const [followUpContent, setFollowUpContent] = useState("");
  // const token = useAuthToken();
  const [{ text, loading }, submitFollowUp] = useStreamingText(
    import.meta.env.VITE_CONVEX_URL.replace(".cloud", ".site") + "/streamText",
    threadId,
  );
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setContent("");
    void startWorkflow({ location: content })
      .then(({ threadId }) => {
        setThreadId(threadId);
      })
      .catch((e) => {
        console.error(e);
        setContent(content);
      });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col gap-12">
        <div className="max-w-lg mx-auto w-full">
          <form onSubmit={handleSubmit}>
            <div className="relative">
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                onKeyDown={handleKeyDown}
                className="w-full min-h-[4rem] max-h-[70vh] p-4 pb-16 rounded-xl border-2 border-indigo-100 text-lg focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-lg overflow-hidden"
                placeholder="Where do you want an outfit for?"
              />
              <button
                type="submit"
                disabled={!content.trim()}
                className="absolute bottom-2 left-2 right-2 px-6 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-medium text-lg hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:hover:from-indigo-600 disabled:hover:to-purple-600 transition-all shadow-inner flex items-center justify-center gap-2"
              >
                <span>Get Outfit For Location</span>
                {content.trim() && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
          </form>
        </div>
        <div className="space-y-6">
          {[...messages.results].reverse().map((message) => {
            // Tool-related messages
            if (
              message.tool &&
              message.message &&
              typeof message.message === "object" &&
              message.message !== null &&
              "role" in message.message &&
              "content" in message.message
            ) {
              const { role, content } = message.message as {
                role: string;
                content: any;
              };

              // Tool-call: assistant is calling a tool
              if (role === "assistant") {
                const calls = Array.isArray(content) ? content : [content];
                const callElements = calls
                  .filter((c: any) => c && c.type === "tool-call")
                  .map((c: any, i: number) => (
                    <div key={i} className="font-mono text-sm text-indigo-700">
                      <strong>Call:</strong> {c.toolName}
                      {c.args && (
                        <>
                          (
                          <span className="text-gray-700">
                            {Object.entries(c.args)
                              .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                              .join(", ")}
                          </span>
                          )
                        </>
                      )}
                    </div>
                  ));
                return callElements.length > 0 ? (
                  <div
                    key={message._id}
                    className="bg-gray-50 border rounded p-4 my-2"
                  >
                    {callElements}
                  </div>
                ) : null;
              }

              // Tool-result: tool is returning a result
              if (role === "tool") {
                const results = Array.isArray(content) ? content : [content];
                const resultElements = results
                  .filter((c: any) => c && c.type === "tool-result")
                  .map((c: any, i: number) => (
                    <div key={i} className="font-mono text-sm text-green-700">
                      <strong>Result from {c.toolName}:</strong>
                      <pre className="bg-white border rounded p-2 mt-1 text-xs">
                        {JSON.stringify(c.result, null, 2)}
                      </pre>
                    </div>
                  ));
                return resultElements.length > 0 ? (
                  <div
                    key={message._id}
                    className="bg-gray-50 border rounded p-4 my-2"
                  >
                    {resultElements}
                  </div>
                ) : null;
              }

              // Fallback for unknown role: render nothing
              return null;
            }

            // Pending tool message (no message content yet)
            if (message.tool) {
              return (
                <div key={message._id}>
                  Pending...
                  <pre>{JSON.stringify(message, null, 2)}</pre>
                </div>
              );
            }

            // Normal user/assistant message
            return (
              <div
                key={message._id}
                className="p-6 rounded-xl border border-indigo-100 shadow-sm"
              >
                {message.message?.role === "assistant" && message.agentName && (
                  <span className="px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium text-sm shadow-sm border border-indigo-100">
                    {message.agentName}
                  </span>
                )}
                <div className="prose prose-lg prose-indigo max-w-none prose-p:mt-2 prose-p:mb-2">
                  <ReactMarkdown>{message.text}</ReactMarkdown>
                </div>
                <div className="text-sm text-indigo-500/70 mt-4">
                  {new Date(message._creationTime).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
        {loading && text && <div>{text}</div>}
        {messages.results.find((m) => m.agentName === "Fashion Agent") && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const prompt = followUpContent;
                setFollowUpContent("");
                void submitFollowUp(prompt).catch(() => {
                  setFollowUpContent(prompt);
                });
              }}
              className="max-w-lg mx-auto w-full bg-white rounded-xl border border-indigo-100 shadow-lg p-6 flex flex-col gap-4"
            >
              <label
                htmlFor="followup"
                className="font-medium text-indigo-700 mb-1"
              >
                Ask a follow-up question
              </label>
              <textarea
                id="followup"
                value={followUpContent}
                onChange={(e) => {
                  setFollowUpContent(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                className="w-full min-h-[3rem] max-h-[40vh] p-4 rounded-lg border-2 border-indigo-100 text-base focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-inner resize-none"
                placeholder="Type your follow-up question..."
              />
              <button
                type="submit"
                disabled={!followUpContent.trim()}
                className="self-end flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-medium text-base hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:hover:from-indigo-600 disabled:hover:to-purple-600 transition-all shadow-inner"
              >
                <span>Send</span>
                {followUpContent.trim() && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                )}
              </button>
            </form>
          </>
        )}
      </div>
      <h2 className="text-2xl font-bold text-center my-8 text-indigo-700">
        Previous Threads
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
        {[...threads.results].map((thread) => (
          <button
            key={thread._id}
            className="flex flex-col p-4 rounded-lg border hover:border-indigo-500 hover:shadow-md transition-all bg-white"
            onClick={() => setThreadId(thread._id)}
          >
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-2 line-clamp-2">
                {thread.title || "Untitled Thread"}
              </h3>
              {thread.summary && (
                <p className="text-gray-600 text-sm line-clamp-2 mb-2">
                  {thread.summary}
                </p>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              {new Date(thread._creationTime).toLocaleDateString()}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
