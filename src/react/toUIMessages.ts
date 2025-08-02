import type {
  UIMessage as AIUIMessage,
  ReasoningUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  StepStartUIPart,
  TextUIPart,
  ToolUIPart,
} from "ai";
import type { MessageDoc } from "../client/index.js";
import { deserializeMessage, toUIFilePart } from "../mapping.js";
import type { MessageStatus } from "../validators.js";

export type UIMessage = AIUIMessage & {
  key: string;
  order: number;
  stepOrder: number;
  status: "streaming" | MessageStatus;
  agentName?: string;
  text: string;
};

export function toUIMessages(
  messages: (MessageDoc & { streaming?: boolean })[],
): UIMessage[] {
  const uiMessages: UIMessage[] = [];
  let assistantMessage: UIMessage | undefined;
  for (const message of messages) {
    const coreMessage = message.message && deserializeMessage(message.message);
    const text = message.text ?? "";
    const content = coreMessage?.content;
    const nonStringContent =
      content && typeof content !== "string" ? content : [];
    if (!coreMessage) continue;
    const common = {
      id: message._id,
      createdAt: new Date(message._creationTime),
      order: message.order,
      stepOrder: message.stepOrder,
      status: message.streaming ? ("streaming" as const) : message.status,
      key: `${message.threadId}-${message.order}-${message.stepOrder}`,
      text,
    };
    const partCommon = {
      state: message.streaming ? ("streaming" as const) : ("done" as const),
      ...(message.providerMetadata
        ? { providerMetadata: message.providerMetadata }
        : {}),
    };
    if (coreMessage.role === "system") {
      uiMessages.push({
        ...common,
        role: "system",
        agentName: message.agentName,
        parts: [{ type: "text", text, ...partCommon } satisfies TextUIPart],
      });
    } else if (coreMessage.role === "user") {
      const parts: UIMessage["parts"] = [];
      if (text) {
        parts.push({ type: "text", text });
      }
      nonStringContent.forEach((contentPart) => {
        switch (contentPart.type) {
          case "file":
          case "image":
            parts.push(toUIFilePart(contentPart));
            break;
        }
      });
      uiMessages.push({
        ...common,
        role: "user",
        parts,
      });
    } else {
      if (coreMessage.role === "tool" && !assistantMessage) {
        console.warn(
          "Tool message without preceding assistant message.. skipping",
          message,
        );
        continue;
      }
      if (!assistantMessage) {
        assistantMessage = {
          ...common,
          role: "assistant",
          agentName: message.agentName,
          parts: [],
        };
        uiMessages.push(assistantMessage);
      } else {
        assistantMessage.status = message.streaming
          ? "streaming"
          : message.status;
      }
      // update it to the last message's id
      assistantMessage.id = message._id;
      if (
        message.reasoning &&
        !nonStringContent.some((c) => c.type === "reasoning")
      ) {
        assistantMessage.parts.push({
          type: "reasoning",
          text: message.reasoning,
          ...partCommon,
        } satisfies ReasoningUIPart);
      }
      if (message.text && !nonStringContent.some((c) => c.type === "text")) {
        assistantMessage.parts.push({
          type: "text",
          text: message.text,
          ...partCommon,
        } satisfies TextUIPart);
      }
      for (const source of message.sources ?? []) {
        if (source.sourceType === "url") {
          assistantMessage.parts.push({
            type: "source-url",
            url: source.url!,
            sourceId: source.id,
            providerMetadata: message.providerMetadata,
            title: source.title,
          } satisfies SourceUrlUIPart);
        } else {
          assistantMessage.parts.push({
            type: "source-document",
            mediaType: source.mediaType,
            sourceId: source.id,
            title: source.title,
            filename: source.filename,
            providerMetadata: message.providerMetadata,
          } satisfies SourceDocumentUIPart);
        }
      }
      for (const contentPart of nonStringContent) {
        switch (contentPart.type) {
          case "text":
            assistantMessage.parts.push({
              ...partCommon,
              ...contentPart,
            } satisfies TextUIPart);
            break;
          case "reasoning":
            assistantMessage.parts.push({
              ...partCommon,
              ...contentPart,
            } satisfies ReasoningUIPart);
            break;
          case "file":
          case "image":
            assistantMessage.parts.push(toUIFilePart(contentPart));
            break;
          case "tool-call":
            assistantMessage.parts.push({
              type: "step-start",
            } satisfies StepStartUIPart);
            assistantMessage.parts.push({
              ...contentPart,
              state: message.streaming ? "input-streaming" : "input-available",
              callProviderMetadata: message.providerMetadata,
            } satisfies ToolUIPart);
            break;
          case "tool-result": {
            const call = assistantMessage.parts.find(
              (part) =>
                part.type === `tool-${contentPart.toolName}` &&
                "toolCallId" in part &&
                part.toolCallId === contentPart.toolCallId,
            ) as ToolUIPart | undefined;
            if (call) {
              if (message.error) {
                call.state = "output-error";
                call.errorText = message.error;
                call.output = contentPart.output;
              } else {
                call.state = "output-available";
                call.output = contentPart.output;
                // Technically we could pull this from the doc.message
                // but the ModelMessage doesn't have it
                // call.providerExecuted = contentPart.providerExecuted;
              }
            } else {
              console.warn(
                "Tool result without preceding tool call.. adding anyways",
                contentPart,
              );
              if (message.error) {
                assistantMessage.parts.push({
                  type: `tool-${contentPart.toolName}`,
                  toolCallId: contentPart.toolCallId,
                  state: "output-error",
                  input: undefined,
                  errorText: message.error,
                  // Technically we could pull this from the doc.message
                  // but the ModelMessage doesn't have it
                  // providerExecuted: contentPart.providerExecuted,
                  callProviderMetadata: message.providerMetadata,
                } satisfies ToolUIPart);
              } else {
                assistantMessage.parts.push({
                  type: `tool-${contentPart.toolName}`,
                  toolCallId: contentPart.toolCallId,
                  state: "output-available",
                  input: undefined,
                  output: contentPart.output,
                  callProviderMetadata: message.providerMetadata,
                } satisfies ToolUIPart);
              }
            }
            break;
          }
        }
      }
    }
    if (
      !message.tool &&
      assistantMessage &&
      assistantMessage.parts.length > 0
    ) {
      // Reset it so the next set of tool calls will create a new assistant message
      assistantMessage = undefined;
    }
  }
  return uiMessages;
}
