import type { ThreadMessageLike } from "@assistant-ui/react";
import type { UIMessage } from "@convex-dev/agent/react";
import { getToolName, isToolUIPart } from "ai";

export function convertMessage(message: UIMessage): ThreadMessageLike {
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
        ...(part.state === "output-available"
          ? { result: part.output }
          : part.state === "output-error"
            ? { result: part.errorText, isError: true }
            : {}),
      });
    }
  }
  return {
    // Convex's key survives the transition from streamed to persisted messages.
    id: message.key,
    role: message.role,
    createdAt: new Date(message._creationTime),
    content,
    ...(message.role === "assistant"
      ? {
          status:
            message.status === "streaming" || message.status === "pending"
              ? { type: "running" as const }
              : message.status === "failed"
                ? { type: "incomplete" as const, reason: "error" as const }
                : { type: "complete" as const, reason: "stop" as const },
        }
      : {}),
  };
}
