import { AssistantRuntimeProvider, AuiIf } from "@assistant-ui/react";
import { useDemoThread } from "../hooks/use-demo-thread";
import { Thread } from "./assistant-ui/Thread";
import { useConvexRuntime } from "./assistant-ui/useConvexRuntime";

export default function ChatAssistantUI() {
  const { threadId, resetThread } = useDemoThread("assistant-ui Chat Example");
  return threadId ? (
    <Conversation
      key={threadId}
      threadId={threadId}
      resetThread={resetThread}
    />
  ) : (
    <p role="status" className="p-8 text-center">
      Loading conversation…
    </p>
  );
}

function Conversation({
  threadId,
  resetThread,
}: {
  threadId: string;
  resetThread: () => Promise<void>;
}) {
  const { runtime, error, paginationStatus, loadMore } =
    useConvexRuntime(threadId);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 flex-col bg-white">
        <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Story Agent
            </h1>
            <p className="text-sm text-slate-500">
              Convex Agent + assistant-ui
            </p>
          </div>
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <button
              type="button"
              onClick={() => void resetThread()}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
            >
              New conversation
            </button>
          </AuiIf>
        </header>
        {error && (
          <div
            role="alert"
            className="mx-auto w-full max-w-3xl px-4 py-3 text-sm text-red-700"
          >
            <p>{error.message}</p>
            {error.prompt && (
              <AuiIf condition={(s) => !s.thread.isRunning && !s.composer.text}>
                <button
                  type="button"
                  className="mt-2 underline"
                  onClick={() => runtime.thread.composer.setText(error.prompt!)}
                >
                  Restore message to composer
                </button>
              </AuiIf>
            )}
          </div>
        )}
        <Thread paginationStatus={paginationStatus} loadMore={loadMore} />
      </div>
    </AssistantRuntimeProvider>
  );
}
