import { useAction, useMutation, usePaginatedQuery } from "convex/react";
import {
  optimisticallySendMessage,
  SmoothText,
  useThreadMessages,
} from "@convex-dev/agent/react";
import { api } from "../../convex/_generated/api";
import { useCallback, useEffect, useState } from "react";
import { EntryId } from "@convex-dev/rag";
import { toast } from "@/hooks/use-toast";

function RagBasicUI() {
  const [selectedEntry, setSelectedEntry] = useState<EntryId | null>(null);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const createThread = useMutation(api.threads.createNewThread);
  useEffect(() => {
    if (threadId) return;
    void createThread({
      title: "RAG Thread",
    }).then((threadId) => {
      setThreadId(threadId);
    });
  }, [createThread, threadId]);

  // Error state
  const [error, setError] = useState<Error | undefined>(undefined);

  // Context form state
  const [addContextForm, setAddContextForm] = useState({
    key: "",
    text: "",
  });
  const [isAddingContext, setIsAddingContext] = useState(false);

  // Chat state
  const [prompt, setPrompt] = useState("");
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(
    new Set(),
  );

  // Actions and queries
  const addContext = useAction(api.rag.ragAsPrompt.addContext);
  const sendMessage = useMutation(
    api.rag.ragAsPrompt.askQuestion,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.rag.utils.listMessagesWithContext),
  );
  const listMessages = useThreadMessages(
    api.rag.utils.listMessagesWithContext,
    threadId ? { threadId } : "skip",
    { initialNumItems: 10, stream: true },
  );
  const globalDocuments = usePaginatedQuery(
    api.rag.utils.listEntries,
    {},
    { initialNumItems: 10 },
  );
  const documentChunks = usePaginatedQuery(
    api.rag.utils.listChunks,
    selectedEntry ? { entryId: selectedEntry } : "skip",
    { initialNumItems: 10 },
  );

  // Handle adding context
  const handleAddContext = useCallback(async () => {
    if (!addContextForm.key.trim() || !addContextForm.text.trim()) return;

    setIsAddingContext(true);
    try {
      await addContext({
        title: addContextForm.key.trim(),
        text: addContextForm.text.trim(),
      });
      setAddContextForm({ key: "", text: "" });
    } catch (error) {
      console.error("Error adding context:", error);
    } finally {
      setIsAddingContext(false);
    }
  }, [addContext, addContextForm]);

  // Handle sending message
  const onSendClicked = useCallback(() => {
    if (!prompt.trim()) return;

    if (!threadId) {
      toast({
        title: "Thread ID is not set",
        description: "Please create a thread first",
      });
      return;
    }
    setPrompt("");
    sendMessage({
      threadId,
      prompt: prompt.trim(),
    }).catch((error) => {
      setError(error);
      console.error("Error sending message:", error);
      setPrompt(prompt);
    });
  }, [sendMessage, threadId, prompt]);

  // Toggle context expansion
  const toggleContextExpansion = useCallback((messageId: string) => {
    setExpandedContexts((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="h-full flex flex-row bg-gray-50 flex-1 min-h-0">
        {/* Left Panel - Context Entries */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full min-h-0">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Add Context
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={addContextForm.key}
                  onChange={(e) =>
                    setAddContextForm((prev) => ({
                      ...prev,
                      key: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter context title"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Text
                </label>
                <textarea
                  value={addContextForm.text}
                  onChange={(e) =>
                    setAddContextForm((prev) => ({
                      ...prev,
                      text: e.target.value,
                    }))
                  }
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter context body"
                />
              </div>

              <button
                onClick={() => void handleAddContext()}
                disabled={
                  isAddingContext ||
                  !addContextForm.key.trim() ||
                  !addContextForm.text.trim()
                }
                className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isAddingContext ? "Adding..." : "Add Context"}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-4">
              <h3 className="mb-3 font-medium text-gray-900">
                Context Entries
              </h3>
              <div className="space-y-2">
                {globalDocuments.results?.map((entry) => (
                  <div
                    key={entry.entryId}
                    className={`p-3 border rounded transition-colors cursor-pointer ${
                      selectedEntry === entry.entryId
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                    }`}
                    onClick={() => setSelectedEntry(entry.entryId)}
                  >
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {entry.title || entry.key}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Status: {entry.status}
                    </div>
                  </div>
                ))}
                {globalDocuments.results?.length === 0 && (
                  <div className="text-sm text-gray-500 text-center py-4">
                    No context entries yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Middle Panel - Entry Chunks */}
        {selectedEntry && (
          <div className="w-1/3 bg-white border-r border-gray-200 flex flex-col h-full min-h-0">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Entry Chunks
                </h2>
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                  title="Close chunks panel"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {globalDocuments.results?.find(
                  (e) => e.entryId === selectedEntry,
                )?.key || "Selected entry"}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {documentChunks.results && documentChunks.results.length > 0 ? (
                <div className="p-4 space-y-3">
                  {documentChunks.results.map((chunk) => (
                    <div
                      key={selectedEntry + "-chunk-" + chunk.order}
                      className="space-y-2"
                    >
                      <div className="text-sm font-medium text-gray-500">
                        Chunk {chunk.order}
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="text-sm text-gray-800 leading-relaxed">
                          {chunk.text}
                        </div>
                      </div>
                    </div>
                  ))}

                  {documentChunks.status === "CanLoadMore" && (
                    <button
                      onClick={() => documentChunks.loadMore(10)}
                      className="w-full py-3 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg hover:bg-blue-50 transition font-medium"
                    >
                      Load More Chunks
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-gray-500">
                    {documentChunks.status === "LoadingFirstPage" ? (
                      <>
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                        <p>Loading chunks...</p>
                      </>
                    ) : (
                      <p>No chunks found</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Panel - Chat Interface */}
        <main className="flex-1 flex flex-col items-center justify-center p-8 h-full min-h-0">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-lg p-6 flex flex-col gap-6 h-full min-h-0 justify-end">
            {listMessages.results && listMessages.results.length > 0 && (
              <div className="flex flex-col gap-4 overflow-y-auto mb-4 flex-1 min-h-0">
                {listMessages.results.map(
                  (message) =>
                    message.text && (
                      <div key={message._id} className="space-y-2">
                        {/* Message */}
                        <div
                          className={`flex ${message.message?.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`rounded-lg px-4 py-2 max-w-lg whitespace-pre-wrap shadow-sm ${
                              message.message?.role === "user"
                                ? "bg-blue-100 text-blue-900"
                                : "bg-gray-200 text-gray-800"
                            }`}
                          >
                            <SmoothText
                              text={message.text}
                              startStreaming={message.streaming}
                            />
                            {!message.text && "..."}
                          </div>
                        </div>

                        {/* Context Section (expandable) - shown after user message */}
                        {message.contextUsed &&
                          message.message?.role === "user" && (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg">
                              <button
                                onClick={() =>
                                  toggleContextExpansion(message._id)
                                }
                                className="w-full px-4 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-t-lg flex items-center justify-between"
                              >
                                <span>
                                  Context Used (
                                  {message.contextUsed.results.length} results)
                                </span>
                                <span className="text-gray-400">
                                  {expandedContexts.has(message._id)
                                    ? "−"
                                    : "+"}
                                </span>
                              </button>

                              {expandedContexts.has(message._id) && (
                                <div className="px-4 pb-4 space-y-2">
                                  {message.contextUsed.results.map(
                                    (result, index) => (
                                      <div
                                        key={index}
                                        className="bg-white border border-gray-200 rounded p-3"
                                      >
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="text-xs font-medium text-gray-600">
                                            Entry:{" "}
                                            {message.contextUsed!.entries.find(
                                              (e) =>
                                                e.entryId === result.entryId,
                                            )?.key || "Unknown"}
                                          </div>
                                          <div className="text-xs text-gray-500">
                                            Score: {result.score.toFixed(3)} |
                                            Order: {result.order}
                                          </div>
                                        </div>
                                        <div className="text-sm text-gray-800 space-y-1">
                                          {result.content.map(
                                            (content, contentIndex) => (
                                              <div key={contentIndex}>
                                                {content.text}
                                              </div>
                                            ),
                                          )}
                                        </div>
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                    ),
                )}
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
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
                placeholder="Ask me anything and I'll leverage the context you added..."
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition font-semibold disabled:opacity-50"
                disabled={!prompt.trim() || !threadId}
              >
                Send
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-gray-400 text-white hover:bg-red-500 transition font-semibold disabled:opacity-50"
                title="Start over"
                onClick={() => {
                  setThreadId(undefined);
                }}
                disabled={!listMessages.results?.length}
              >
                Start over
              </button>
            </form>
          </div>
        </main>
      </div>
      {error && <div className="text-red-500 text-center">{error.message}</div>}
    </div>
  );
}

export default RagBasicUI;
