import { useAction, useMutation } from "convex/react";
import { Toaster } from "../components/ui/toaster";
import { api } from "../../convex/_generated/api";
import {
  optimisticallySendMessage,
  toUIMessages,
  useThreadMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "../hooks/use-toast";

function getThreadIdFromHash() {
  return window.location.hash.replace(/^#/, "") || undefined;
}

export default function Example() {
  const uploadFile = useAction(api.files.addFile.uploadFile);
  const [question, setQuestion] = useState("What's in this image?");

  const [threadId, setThreadId] = useState<string | undefined>(
    typeof window !== "undefined" ? getThreadIdFromHash() : undefined,
  );
  const submitFileQuestion = useMutation(
    api.files.addFile.submitFileQuestion,
  ).withOptimisticUpdate((store, args) => {
    if (!threadId) return;
    optimisticallySendMessage(api.chat.basic.listThreadMessages)(store, {
      prompt: args.question,
      threadId,
    });
  });
  const [file, setFile] = useState<{ fileId: string; url: string } | undefined>(
    undefined,
  );
  const messages = useThreadMessages(
    api.chat.basic.listThreadMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 10 },
  );

  // Listen for hash changes
  useEffect(() => {
    function onHashChange() {
      setThreadId(getThreadIdFromHash());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // window.location.hash = newId;
  const handleFileUpload = useCallback(
    async (file: File) => {
      const { fileId, url } = await uploadFile({
        bytes: await file.arrayBuffer(),
        filename: file.name,
        mimeType: file.type,
      });
      setFile({ fileId, url });
    },
    [uploadFile],
  );

  const handleSubmitFileQuestion = useCallback(
    async (question: string) => {
      if (!file?.fileId) throw new Error("No file selected");
      setQuestion("");
      await submitFileQuestion({
        fileId: file?.fileId,
        question,
      })
        .then(({ threadId }) => {
          setThreadId(threadId);
          window.location.hash = threadId;
        })
        .catch((e) => {
          toast({
            title: "Failed to submit question",
            description: e.message,
          });
          setQuestion((q) => q || question);
        });
    },
    [submitFileQuestion, file?.fileId],
  );

  return (
    <>
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm p-4 flex justify-between items-center border-b">
        <h1 className="text-xl font-semibold accent-text">
          Files and Images Example
        </h1>
      </header>
      <div className="min-h-screen flex flex-col bg-gray-50">
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-xl mx-auto flex flex-col items-center gap-6 bg-white rounded-2xl shadow-lg p-8 border border-gray-200">
            {/* Image Preview */}

            {/* Chat Messages */}
            {messages.results?.length > 0 ? (
              <>
                <div className="w-full flex flex-col gap-4 overflow-y-auto mb-6 px-2">
                  {toUIMessages(messages.results ?? []).map((m) => (
                    <Message key={m.key} message={m} />
                  ))}
                </div>
                <button
                  className="w-full px-4 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition font-medium mt-2"
                  onClick={() => {
                    setThreadId(undefined);
                    setFile(undefined);
                    setQuestion("What's in this image?");
                    window.location.hash = "";
                  }}
                  type="button"
                >
                  Start over
                </button>
              </>
            ) : (
              <>
                {file && (
                  <div className="w-full flex flex-col items-center mb-4">
                    <img
                      src={file.url}
                      alt={file.fileId}
                      className="max-h-64 rounded-xl border border-gray-300 shadow-md object-contain bg-gray-100"
                    />
                  </div>
                )}
                <form
                  className="w-full flex flex-col gap-4 items-center"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSubmitFileQuestion(question);
                  }}
                >
                  <input
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFileUpload(file);
                    }}
                    className="w-full file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition"
                  />
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-lg"
                    placeholder="Ask a question about the file"
                    // disabled={!file?.fileId}
                  />
                  <button
                    type="submit"
                    className="w-full px-4 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition font-semibold text-lg disabled:opacity-50"
                    disabled={!file?.fileId || !question.trim()}
                  >
                    Send
                  </button>
                </form>
              </>
            )}
          </div>
        </main>
        <Toaster />
      </div>
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
              return <div key={key}>{part.text}</div>;
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
