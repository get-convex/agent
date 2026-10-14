import { useExternalStoreRuntime } from "@assistant-ui/react";
import { useUIMessages } from "@convex-dev/agent/react";
import { useAction, useMutation } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { convertMessage } from "./convertMessage";

export function useConvexRuntime(threadId: string) {
  const { results, status, loadMore } = useUIMessages(
    api.chat.streaming.listThreadMessages,
    { threadId },
    { initialNumItems: 10, stream: true },
  );
  const sendMessage = useAction(api.chat.streaming.streamOneShot);
  const abortStream = useMutation(api.chat.streamAbort.abortStreamByOrder);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<{ message: string; prompt?: string }>();
  const cancelled = useRef(false);
  const streamingMessage = results.findLast(
    (message) => message.role === "assistant" && message.status === "streaming",
  );

  const runtime = useExternalStoreRuntime({
    messages: results,
    convertMessage,
    isLoading: status === "LoadingFirstPage",
    isDisabled: status === "LoadingFirstPage",
    isRunning:
      isSending ||
      results.some(
        (message) =>
          message.role === "assistant" &&
          (message.status === "pending" || message.status === "streaming"),
      ),
    onNew: async (message) => {
      if (
        message.attachments?.length ||
        message.content.some((part) => part.type !== "text")
      ) {
        throw new Error("This example accepts text messages only.");
      }
      const prompt = message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n");
      setError(undefined);
      setIsSending(true);
      cancelled.current = false;
      try {
        // This action resolves after the stream and final message are persisted.
        await sendMessage({ threadId, prompt });
      } catch (cause) {
        if (!cancelled.current) {
          setError({
            message:
              cause instanceof Error
                ? cause.message
                : "Unable to send the message.",
            prompt,
          });
        }
      } finally {
        setIsSending(false);
      }
    },
    ...(streamingMessage
      ? {
          onCancel: async () => {
            cancelled.current = true;
            try {
              await abortStream({ threadId, order: streamingMessage.order });
            } catch (cause) {
              cancelled.current = false;
              setError({
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Unable to stop the response.",
              });
            }
          },
        }
      : {}),
  });

  return { runtime, error, paginationStatus: status, loadMore };
}
