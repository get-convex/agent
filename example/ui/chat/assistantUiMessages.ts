import type { ThreadMessageLike } from "@assistant-ui/react";
import type { UIMessage } from "@convex-dev/agent/react";
import { isToolUIPart, getToolName } from "ai";

export function toAssistantUIMessage(message: UIMessage): ThreadMessageLike {
  const content: Exclude<ThreadMessageLike["content"], string>[number][] = [];
  for (const part of message.parts) {
    if (part.type === "text" || part.type === "reasoning") {
      content.push({ type: part.type, text: part.text });
    } else if (isToolUIPart(part)) {
      content.push({
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: getToolName(part),
        argsText: JSON.stringify(part.input ?? {}),
        result:
          part.state === "output-available"
            ? part.output
            : part.state === "output-error"
              ? part.errorText
              : undefined,
        isError: part.state === "output-error",
      });
    }
  }
  return {
    // Agent keys stay stable as streamed messages become persisted messages.
    id: message.key,
    role: message.role,
    createdAt: new Date(message._creationTime),
    content,
    status:
      message.role !== "assistant"
        ? undefined
        : message.status === "streaming" || message.status === "pending"
          ? { type: "running" }
          : message.status === "failed"
            ? {
                type: "incomplete",
                reason: "error",
                error:
                  "The response failed or was stopped. Send a message to continue.",
              }
            : { type: "complete", reason: "stop" },
  };
}
