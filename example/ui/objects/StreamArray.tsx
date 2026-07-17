import { useState } from "react";
import { useDeltaStreams } from "../../../src/vercel/react/useDeltaStreams";
import { api } from "../../convex/_generated/api";
import { Toaster } from "../components/ui/toaster";
import { useDemoThread } from "@/hooks/use-demo-thread";
import { useAction } from "convex/react";

export default function StreamArray() {
  const { threadId, resetThread } = useDemoThread("Streaming Objects Example");
  const [used, setUsed] = useState(false);

  const generateList = useAction(api.objects.streamArray.streamArray);

  const messages = useDeltaStreams(
    api.objects.streamArray.listDeltas,
    threadId ? { threadId } : "skip",
  );

  return (
    <>
      <header className="sticky top-0 h-16 z-10 bg-white/80 backdrop-blur-sm p-4 flex justify-between items-center border-b">
        <h1 className="text-xl font-semibold accent-text">
          Streaming Array Example
        </h1>
        {threadId}
      </header>
      <h2 className="text-center text-xl text-gray-500">
        What might you bring to a birthday party?
      </h2>
      <div className="h-[calc(100vh-8rem)] flex flex-col bg-gray-50">
        {used ? (
          <div>
            <button
              className="bg-blue-500 text-white p-2 rounded "
              onClick={() =>
                void resetThread()
                  .then(() => setUsed(false))
                  .catch(console.error)
              }
            >
              Reset
            </button>
            {messages?.map((message) => (
              <div key={message.streamMessage.streamId}>
                {message.streamMessage.streamId}
                {message.deltas
                  .flatMap(({ parts }) => parts)
                  .map((part: { name: string; quantity: number }, i) => (
                    <div key={message.streamMessage.streamId + "-" + i}>
                      {part.name}: {part.quantity}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex justify-center items-center h-full">
            <button
              className="bg-blue-500 text-white p-2 rounded "
              disabled={!threadId}
              onClick={() => {
                setUsed(true);
                void generateList({ threadId: threadId! }).catch(console.error);
              }}
            >
              Generate List
            </button>
          </div>
        )}
        <Toaster />
      </div>
    </>
  );
}
