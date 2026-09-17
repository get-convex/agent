import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import {
  optimisticallySendMessage,
  useUIMessages,
} from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useDemoThread } from "../hooks/use-demo-thread";
import { Thread } from "../components/assistant-ui/elements/thread.aui";
import { Button } from "../components/ui/button";
import "./assistant-ui.css";
import { toAssistantUIMessage } from "./assistantUiMessages";

export default function ChatAssistantUI() {
  const { threadId, resetThread } = useDemoThread("assistant-ui Example");
  return (
    <div className="assistant-ui-example h-full min-h-0 flex flex-col bg-background text-foreground">
      <header className="bg-background p-4 border-b">
        <h1 className="text-xl font-semibold">assistant-ui Chat</h1>
        <p className="text-sm text-muted-foreground">
          assistant-ui components with persistent, streaming Convex Agent
          messages.
        </p>
      </header>
      {threadId ? (
        // Remount the runtime when switching threads so drafts and errors reset.
        <Chat key={threadId} threadId={threadId} resetThread={resetThread} />
      ) : (
        <p className="p-6" role="status">
          Creating a thread...
        </p>
      )}
    </div>
  );
}

function Chat({
  threadId,
  resetThread,
}: {
  threadId: string;
  resetThread: () => Promise<void>;
}) {

  const {
    results: messages,
    status,
    loadMore,
  } = useUIMessages(
    api.chat.streaming.listThreadMessages,
    { threadId },
    { initialNumItems: 20, stream: true },
  );
  const sendMessage = useMutation(
    api.chat.streaming.initiateAsyncStreaming,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.streaming.listThreadMessages),
  );
  const abortStream = useMutation(api.chat.streamAbort.abortStreamByOrder);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();
  const streamingMessage = messages.find(
    (message) => message.status === "streaming",
  );
  const isRunning =
    isSending ||
    messages.some(
      (message) =>
        message.status === "streaming" || message.status === "pending",
    );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const prompt = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      if (!prompt.trim()) return;
      setError(undefined);
      setIsSending(true);
      try {
        await sendMessage({ threadId, prompt });
      } catch (cause) {
        setError("Could not send your message. Please try again.");
        // Reject so assistant-ui restores the unsent composer draft.
        throw cause;
      } finally {
        setIsSending(false);
      }
    },
    [sendMessage, threadId],
  );

  const onCancel = useCallback(async () => {
    if (!streamingMessage) return;
    try {
      await abortStream({ threadId, order: streamingMessage.order });
    } catch {
      setError("Could not stop the response. Please try again.");
    }
  }, [abortStream, streamingMessage, threadId]);

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: toAssistantUIMessage,
    isRunning,
    isLoading: status === "LoadingFirstPage",
    isDisabled: status === "LoadingFirstPage",
    onNew,
    onCancel,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex items-center justify-between px-4 py-2">
        <div>
          {(status === "CanLoadMore" || status === "LoadingMore") && (
            <Button
              variant="ghost"
              size="sm"
              disabled={status !== "CanLoadMore"}
              onClick={() => loadMore(20)}
            >
              {status === "LoadingMore" ? "Loading..." : "Load older messages"}
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={isRunning}
          onClick={() => {
            void resetThread().catch(() =>
              setError("Could not create a thread. Please try again."),
            );
          }}
        >
          New thread
        </Button>
      </div>
      {error && (
        <p role="alert" className="px-6 py-2 text-destructive">
          {error}
        </p>
      )}
      {status === "LoadingFirstPage" && (
        <p role="status" className="px-6 text-sm text-muted-foreground">
          Loading messages...
        </p>
      )}
      <div className="flex-1 min-h-0">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
