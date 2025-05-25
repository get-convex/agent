import { usePaginatedQuery } from "convex/react";
import { useMutation } from "convex/react";
import { Toaster } from "./components/ui/toaster";
import { api } from "../convex/_generated/api";
import { toUIMessages } from "../../../dist/esm/client";
import { UIMessage } from "ai";
import { useState } from "react";

export default function App() {
  const createThread = useMutation(api.chat.createThread);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 p-8">
        {threadId ? (
          <Story threadId={threadId} />
          <button onClick={() => createThread().then(setThreadId)}>Restart</button>
        ) : (
          <button onClick={() => createThread().then(setThreadId)}>Create thread</button>
        )}
      </main>
      <Toaster />
    </div>
  );
}

function Story({ threadId }: { threadId: string }) {
  const messages = usePaginatedQuery(
    api.chat.listMessages,
    { threadId },
    { initialNumItems: 10 },
  );
  const sendMessage = useMutation(api.chat.streamStoryInternalAction);

  async function onSendClicked() {
    await sendMessage({ threadId, prompt, stream: true });
    // TODO: .withOptimisticUpdate(... patch messages);
  }

  return (
    <>
      {toUIMessages(messages ?? []).map((m) => (
        <Message m={m} />
      ))}
      <StreamedMessages threadId={threadId} />
      <button onClick={onSendClicked}>Send</button>
    </>
  );
}

function Message({ m }: { m: UIMessage }) {
  return <div>{m.content}</div>;
}
// A separate component helps avoid re-rendering all messages when only the streaming ones are changing
function StreamedMessages({ threadId }: { threadId: string }) {
  const streamedMessages = useStreamingMessagesQuery(
    api.chat.streamMessageDeltas,
    { threadId }, // other parameters can be passed
  );
  return <>{streamedMessages?.map((m) => <Message m={m} />)}</>;
}
