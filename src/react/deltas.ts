import type {
  ProviderMetadata,
  TextStreamPart,
  ToolSet,
  UIMessageChunk,
} from "ai";
import type { MessageDoc } from "../client/index.js";
import {
  vSource,
  type Message,
  type MessageStatus,
  type StreamDelta,
  type StreamMessage,
  type vFilePart,
  type vReasoningPart,
  type vTextPart,
  type vToolCallPart,
  type vToolResultPart,
} from "../validators.js";
import type { Infer } from "convex/values";
import { serializeWarnings } from "../mapping.js";
import { parse } from "convex-helpers/validators";

export function mergeDeltas(
  threadId: string,
  streamMessages: StreamMessage[],
  existingStreams: Array<{
    streamId: string;
    cursor: number;
    messages: MessageDoc[];
  }>,
  allDeltas: StreamDelta[],
): [
  MessageDoc[],
  Array<{ streamId: string; cursor: number; messages: MessageDoc[] }>,
  boolean,
] {
  const newStreams: Array<{
    streamId: string;
    cursor: number;
    messages: MessageDoc[];
  }> = [];
  // Seed the existing chunks
  let changed = false;
  for (const streamMessage of streamMessages) {
    const deltas = allDeltas.filter(
      (d) => d.streamId === streamMessage.streamId,
    );
    const existing = existingStreams.find(
      (s) => s.streamId === streamMessage.streamId,
    );
    const [newStream, messageChanged] = applyDeltasToStreamMessage(
      threadId,
      streamMessage,
      existing,
      deltas,
    );
    newStreams.push(newStream);
    if (messageChanged) changed = true;
  }
  for (const { streamId } of existingStreams) {
    if (!newStreams.find((s) => s.streamId === streamId)) {
      // There's a stream that's no longer active.
      changed = true;
    }
  }
  const messages = newStreams
    .map((s) => s.messages)
    .flat()
    .sort((a, b) => a.order - b.order || a.stepOrder - b.stepOrder);
  return [messages, newStreams, changed];
}

export function getParts(
  stream: { streamId: string; cursor: number },
  streamDeltas: StreamDelta[],
) {
  const deltas = streamDeltas.filter((d) => d.streamId === stream.streamId);
  const parts: UIMessageChunk<ToolSet>[] = [];
  let cursor = stream.cursor;
  for (const delta of deltas.sort((a, b) => a.start - b.start)) {
    if (delta.parts.length === 0) {
      console.warn(`Got delta with no parts: ${JSON.stringify(delta)}`);
      continue;
    }
    if (cursor !== delta.start) {
      if (cursor >= delta.end) {
        console.debug(
          `Got duplicate delta for stream ${delta.streamId} at ${delta.start}`,
        );
        continue;
      } else if (cursor < delta.start) {
        console.warn(
          `Got delta for stream ${delta.streamId} that has a gap ${cursor} -> ${delta.start}`,
        );
        continue;
      } else {
        throw new Error(
          `Got unexpected delta for stream ${delta.streamId}: delta: ${delta.start} -> ${delta.end} existing cursor: ${cursor}`,
        );
      }
    }
    cursor = delta.end;
  }
  return { parts, cursor };
}

// TODO: use readUIMessageStream to produce message docs
// set extra fields on the UIMessages
//   key: string;
//   order: number;
//   stepOrder: number;
//   status: "streaming" | MessageStatus;
//   agentName?: string;
//   text: string;
// update status based on whether the message is done, aborted, errored, etc.
// update stepOrder based on how many messages are wrapped up in the UIMessage
// using the step-start part

// exported for testing
export function applyDeltasToStreamMessage(
  threadId: string,
  streamMessage: StreamMessage,
  existing:
    | { streamId: string; cursor: number; messages: MessageDoc[] }
    | undefined,
  deltas: StreamDelta[],
): [{ streamId: string; cursor: number; messages: MessageDoc[] }, boolean] {
  let changed = false;
  let cursor = existing?.cursor ?? 0;
  let parts: (UIMessageChunk<ToolSet> | TextStreamPart<ToolSet>)[] = [];
  for (const delta of deltas.sort((a, b) => a.start - b.start)) {
    if (delta.parts.length === 0) {
      console.warn(`Got delta with no parts: ${JSON.stringify(delta)}`);
      continue;
    }
    if (cursor !== delta.start) {
      if (cursor >= delta.end) {
        console.debug(
          `Got duplicate delta for stream ${delta.streamId} at ${delta.start}`,
        );
        continue;
      } else if (cursor < delta.start) {
        console.warn(
          `Got delta for stream ${delta.streamId} that has a gap ${cursor} -> ${delta.start}`,
        );
        continue;
      } else {
        throw new Error(
          `Got unexpected delta for stream ${delta.streamId}: delta: ${delta.start} -> ${delta.end} existing cursor: ${cursor}`,
        );
      }
    }
    changed = true;
    cursor = delta.end;
    parts.push(...delta.parts);
  }
  if (existing && existing.messages.length > 0 && !changed) {
    const lastMessage = existing.messages.at(-1)!;
    if (statusFromStreamStatus(streamMessage.status) !== lastMessage.status) {
      changed = true;
    }
  }
  if (!changed) {
    return [
      existing ?? { streamId: streamMessage.streamId, cursor, messages: [] },
      false,
    ];
  }

  const existingMessages = existing?.messages ?? [];

  let currentMessage: MessageDoc;
  if (existingMessages.length > 0) {
    // replace the last message with a new one
    const lastMessage = existingMessages.at(-1)!;
    currentMessage = {
      ...lastMessage,
      message: cloneMessageAndContent(lastMessage.message),
      status: statusFromStreamStatus(streamMessage.status),
    };
  } else {
    const newMessage = createStreamingMessage(
      threadId,
      streamMessage,
      parts[0]!,
      existingMessages.length,
    );
    parts = parts.slice(1);
    currentMessage = newMessage;
  }
  const newStream = {
    streamId: streamMessage.streamId,
    cursor,
    messages: [...existingMessages.slice(0, -1), currentMessage],
  };
  let lastContent = getLastContent(currentMessage);
  for (const part of parts) {
    let contentToAdd:
      | Infer<typeof vTextPart>
      | Infer<typeof vToolCallPart>
      | Infer<typeof vToolResultPart>
      | Infer<typeof vReasoningPart>
      | Infer<typeof vFilePart>
      | undefined;
    const isToolRole = part.type === "source" || part.type === "tool-result";
    if (isToolRole !== (currentMessage.message!.role === "tool")) {
      currentMessage = createStreamingMessage(
        threadId,
        streamMessage,
        part,
        newStream.messages.length,
      );
      lastContent = getLastContent(currentMessage);
      newStream.messages.push(currentMessage);
      continue;
    }
    switch (part.type) {
      case "text-delta": {
        const text = "text" in part ? part.text : part.delta;
        if (!text) {
          console.warn("Got text delta with no text", part);
        }
        currentMessage.text = (currentMessage.text ?? "") + text;
        if (lastContent?.type === "text") {
          lastContent.text = (lastContent.text ?? "") + text;
          lastContent.providerMetadata = mergeProviderMetadata(
            lastContent.providerMetadata,
            part.providerMetadata,
          );
        } else {
          contentToAdd = {
            type: "text",
            providerMetadata: part.providerMetadata,
            text,
          } satisfies Infer<typeof vTextPart>;
        }
        break;
      }
      case "tool-input-available": {
        if (
          lastContent?.type === "tool-call" &&
          lastContent.toolCallId === part.toolCallId
        ) {
          lastContent.args = part.input;
          lastContent.providerExecuted ??= part.providerExecuted;
          lastContent.providerMetadata = mergeProviderMetadata(
            lastContent.providerMetadata,
            part.providerMetadata,
          );
        } else {
          contentToAdd = toolCallContent(part);
        }
        break;
      }
      case "tool-input-start": {
        const toolCallId = "id" in part ? part.id : part.toolCallId;
        currentMessage.tool = true;
        contentToAdd = {
          type: "tool-call",
          toolCallId,
          toolName: part.toolName,
          args: "",
          providerMetadata:
            "providerMetadata" in part ? part.providerMetadata : undefined,
          providerExecuted:
            "providerExecuted" in part ? part.providerExecuted : undefined,
        } satisfies Infer<typeof vToolCallPart>;
        break;
      }
      case "tool-input-delta":
        {
          currentMessage.tool = true;
          if (lastContent?.type !== "tool-call") {
            throw new Error("Expected last content to be a tool call");
          }
          if (typeof lastContent.args !== "string") {
            lastContent.args = lastContent.args?.toString() ?? "";
          }
          const delta =
            "inputTextDelta" in part
              ? part.inputTextDelta
              : "delta" in part
                ? part.delta
                : "";
          lastContent.args = lastContent.args + delta;
          lastContent.providerMetadata =
            "providerMetadata" in part
              ? mergeProviderMetadata(
                  lastContent.providerMetadata,
                  part.providerMetadata,
                )
              : undefined;
        }
        break;
      case "tool-call": {
        currentMessage.tool = true;
        contentToAdd = toolCallContent(part);
        break;
      }
      case "tool-output-available":
        if (
          lastContent?.type === "tool-call" &&
          lastContent.toolCallId === part.toolCallId
        ) {
          contentToAdd = {
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: lastContent.toolName,
            args: lastContent.args,
            result: part.output,
            providerExecuted: part.providerExecuted,
          } satisfies Infer<typeof vToolResultPart>;
        } else if (
          lastContent?.type === "tool-result" &&
          lastContent.toolCallId === part.toolCallId
        ) {
          lastContent.result = part.output;
          lastContent.providerExecuted = part.providerExecuted;
        } else {
          console.warn(
            "Got tool output available part for unknown tool call",
            part,
          );
        }
        break;
      case "tool-result": {
        contentToAdd = toolResultContent(part);
        break;
      }
      case "reasoning-delta": {
        const text = "text" in part ? part.text : part.delta;
        currentMessage.reasoning = (currentMessage.reasoning ?? "") + text;
        if (lastContent?.type === "reasoning") {
          lastContent.text = (lastContent.text ?? "") + text;
          lastContent.providerMetadata = mergeProviderMetadata(
            lastContent.providerMetadata,
            part.providerMetadata,
          );
        } else {
          contentToAdd = {
            type: "reasoning",
            text,
            providerMetadata: part.providerMetadata,
          } satisfies Infer<typeof vReasoningPart>;
        }
        break;
      }
      case "source":
        if (!currentMessage.sources) {
          currentMessage.sources = [];
        }
        currentMessage.sources.push(parse(vSource, part));
        console.warn("Got source part with unknown source type", part);
        break;
      case "abort":
        currentMessage.status = "failed";
        currentMessage.error = "abort";
        break;
      case "error":
        currentMessage.status = "failed";
        currentMessage.error =
          "error" in part ? part.error?.toString() : part.errorText;
        break;
      case "message-metadata":
        currentMessage.providerMetadata ??= {};
        currentMessage.providerMetadata["metadata"] = {
          parts: [part.messageMetadata],
        };
        console.warn(
          "Putting message metadata part in providerMetadata. Use useUIMessages or useStreamingUIMessages instead.",
          part,
        );
        break;
      case "source-document":
        contentToAdd = {
          type: "file",
          data: part.sourceId,
          mimeType: part.mediaType,
          filename: part.title ?? part.filename,
          providerMetadata: part.providerMetadata,
        } satisfies Infer<typeof vFilePart>;
        break;
      case "source-url":
        contentToAdd = {
          type: "file",
          data: part.url,
          filename: part.title,
          mimeType: "text/plain", // What do we do here?
          providerMetadata: part.providerMetadata,
        } satisfies Infer<typeof vFilePart>;
        break;
      case "tool-input-error":
        if (
          lastContent?.type === "tool-call" &&
          lastContent.toolCallId === part.toolCallId
        ) {
          lastContent.args ||= part.input;
          lastContent.providerExecuted ??= part.providerExecuted;
          lastContent.providerMetadata = mergeProviderMetadata(
            lastContent.providerMetadata,
            part.providerMetadata,
          );
        } else {
          if (
            lastContent?.type === "tool-result" &&
            lastContent.toolCallId === part.toolCallId
          ) {
            lastContent.isError = true;
            lastContent.providerExecuted ??= part.providerExecuted;
            lastContent.providerMetadata = mergeProviderMetadata(
              lastContent.providerMetadata,
              part.providerMetadata,
            );
          } else {
            contentToAdd = toolCallContent(part);
          }
        }
        currentMessage.error = part.errorText;
        break;
      case "tool-output-error":
        if (
          lastContent?.type === "tool-result" &&
          lastContent.toolCallId === part.toolCallId
        ) {
          lastContent.isError = true;
          lastContent.result = part.errorText;
          lastContent.providerExecuted = part.providerExecuted;
        } else if (
          lastContent?.type === "tool-call" &&
          lastContent.toolCallId === part.toolCallId
        ) {
          console.warn(
            "Got tool output error part for unknown tool result",
            part,
          );
          contentToAdd = {
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: lastContent.toolName,
            args: lastContent.args,
            result: part.errorText,
            providerExecuted: part.providerExecuted,
            isError: true,
          } satisfies Infer<typeof vToolResultPart>;
        } else {
          console.warn(
            "Got tool output error part for unknown tool call",
            part,
          );
        }
        break;
      case "tool-error":
        if (
          lastContent?.type === "tool-result" &&
          lastContent.toolCallId === part.toolCallId
        ) {
          lastContent.isError = true;
          lastContent.result = part.error;
          lastContent.providerExecuted = part.providerExecuted;
        } else {
          if (
            lastContent?.type === "tool-call" &&
            lastContent.toolCallId === part.toolCallId
          ) {
            lastContent.args ||= part.input;
            lastContent.providerExecuted ??= part.providerExecuted;
          }
          currentMessage.error = part.error?.toString();
          contentToAdd = {
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            result: part.error,
            providerExecuted: part.providerExecuted,
            isError: true,
            args: part.input,
          } satisfies Infer<typeof vToolResultPart>;
        }
        break;
      case "tool-input-end":
      case "text-end":
      case "reasoning-end":
      case "finish-step":
      case "finish":
      case "file":
      case "raw":
      case "start-step":
      case "text-start":
      case "reasoning-start":
      case "start":
        // ignore
        break;
      default: {
        if (!part.type.startsWith("data-")) {
          console.warn(`Received unexpected part: ${JSON.stringify(part)}`);
        } else {
          console.warn(
            "Dropping a data part. Use useUIMessages or useStreamingUIMessages instead for full UIMessage streaming support.",
            part,
          );
        }
        break;
      }
    }
    if (contentToAdd) {
      if (!currentMessage.message!.content) {
        currentMessage.message!.content = [];
      }
      if (!Array.isArray(currentMessage.message?.content)) {
        throw new Error("Expected message content to be an array");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentMessage.message.content.push(contentToAdd as any);
      lastContent = contentToAdd;
    }
  }
  return [newStream, true];
}

function mergeProviderMetadata(
  existing: ProviderMetadata | undefined,
  part: ProviderMetadata | undefined,
): ProviderMetadata | undefined {
  if (!existing && !part) {
    return undefined;
  }
  if (!existing) {
    return part;
  }
  if (!part) {
    return existing;
  }
  const merged: ProviderMetadata = existing;
  for (const [provider, metadata] of Object.entries(part)) {
    merged[provider] = {
      ...merged[provider],
      ...metadata,
    };
  }
  return merged;
}

function toolCallContent(
  part:
    | Extract<TextStreamPart<ToolSet>, { type: "tool-call" }>
    | Extract<UIMessageChunk<ToolSet>, { type: "tool-input-error" }>
    | Extract<UIMessageChunk<ToolSet>, { type: "tool-input-available" }>,
): Infer<typeof vToolCallPart> {
  const args = "args" in part ? part.args : part.input;
  return {
    type: "tool-call",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    args,
    providerMetadata: part.providerMetadata,
    providerExecuted: part.providerExecuted,
  } satisfies Infer<typeof vToolCallPart>;
}

function toolResultContent(
  part: Extract<TextStreamPart<ToolSet>, { type: "tool-result" }>,
): Infer<typeof vToolResultPart> {
  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    result: part.output,
    args: part.input,
    providerExecuted: part.providerExecuted,
  } satisfies Infer<typeof vToolResultPart>;
}
function cloneMessageAndContent(
  message: Message | undefined,
): Message | undefined {
  return (
    message &&
    ({
      ...message,
      content: Array.isArray(message.content)
        ? [...message.content]
        : message.content,
    } as typeof message)
  );
}

function getLastContent(message: MessageDoc) {
  if (Array.isArray(message.message?.content)) {
    return message.message.content.at(-1);
  }
  return undefined;
}

function statusFromStreamStatus(
  status: StreamMessage["status"],
): MessageStatus {
  switch (status) {
    case "streaming":
      return "pending";
    case "finished":
      return "success";
    case "aborted":
      return "failed";
    default:
      return "pending";
  }
}

// TODO: share more code with applyDeltasToStreamMessage
export function createStreamingMessage(
  threadId: string,
  message: StreamMessage,
  part: UIMessageChunk<ToolSet> | TextStreamPart<ToolSet>,
  index: number,
): MessageDoc {
  const { streamId, ...rest } = message;
  const metadata: MessageDoc = {
    ...rest,
    _id: `${streamId}-${index}`,
    _creationTime: Date.now(),
    status: statusFromStreamStatus(message.status),
    threadId,
    tool: false,
  };
  const providerMetadata =
    "providerMetadata" in part ? part.providerMetadata : undefined;
  metadata.providerMetadata = providerMetadata;

  switch (part.type) {
    case "text-delta": {
      const text = "text" in part ? part.text : part.delta;
      return {
        ...metadata,
        message: {
          role: "assistant",
          content: [{ type: "text", text, providerMetadata }],
        },
        text,
      };
    }
    case "tool-input-start": {
      return {
        ...metadata,
        tool: true,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: part.toolName,
              toolCallId: "id" in part ? part.id : part.toolCallId,
              args: "", // when it's a string, it's a partial call
              providerExecuted:
                "providerExecuted" in part ? part.providerExecuted : undefined,
              providerMetadata,
            },
          ],
        },
      };
    }
    case "tool-input-delta": {
      console.warn("Received tool call delta part first??");
      const delta = "delta" in part ? part.delta : part.inputTextDelta;
      const toolCallId = "id" in part ? part.id : part.toolCallId;
      const toolName = part.type.slice("tool-".length);
      return {
        ...metadata,
        tool: true,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId,
              toolName,
              args: delta,
              providerMetadata,
            },
          ],
        },
      };
    }
    case "tool-call": {
      return {
        ...metadata,
        tool: true,
        message: { role: "assistant", content: [toolCallContent(part)] },
      };
    }
    case "tool-result":
      return {
        ...metadata,
        tool: true,
        message: { role: "tool", content: [toolResultContent(part)] },
      };
    case "reasoning-delta": {
      const text = "text" in part ? part.text : part.delta;
      return {
        ...metadata,
        message: {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text,
              providerMetadata,
            },
          ],
        },
        reasoning: text,
      };
    }
    case "source":
      console.warn("Received source part first??");
      return {
        ...metadata,
        tool: true,
        message: { role: "tool", content: [] },
        sources: [part],
      };
    case "raw":
    case "start":
      return {
        ...metadata,
        tool: false,
        message: { role: "assistant", content: [] },
      };
    case "start-step":
      return {
        ...metadata,
        message: { role: "assistant", content: [] },
        ...("warnings" in part && part.warnings?.length > 0
          ? { warnings: serializeWarnings(part.warnings) }
          : {}),
      };
    case "reasoning-start":
      return {
        ...metadata,
        message: { role: "assistant", content: [] },
        reasoning: "",
      };
    case "abort":
      return {
        ...metadata,
        message: { role: "assistant", content: [] },
        status: "failed",
        error: "abort",
      };
    case "tool-error":
      return {
        ...metadata,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: part.toolCallId,
              args: part.input,
              toolName: part.toolName,
              providerExecuted: part.providerExecuted,
              providerMetadata,
            },
            {
              type: "tool-result",
              result: part.error,
              toolCallId: part.toolCallId,
              isError: true,
              args: part.input,
              toolName: part.toolName,
              providerExecuted: part.providerExecuted,
            },
          ],
        },
        error: part.error?.toString(),
      };
    case "text-start":
      return {
        ...metadata,
        message: { role: "assistant", content: [] },
        providerMetadata,
        id: part.id,
        _id: part.id,
      };
    case "error": {
      const errorMessage: MessageDoc = {
        ...metadata,
        message: {
          role: "assistant",
          content: [],
        },
      };
      if ("error" in part) {
        errorMessage.error = part.error?.toString();
      } else if (part.errorText) {
        errorMessage.error = part.errorText;
      } else {
        console.warn("Got an error delta with no error", part);
      }
      return errorMessage;
    }
    // case "raw":
    //   return {
    //     ...metadata,
    //     message: { role: "assistant", content: [part.rawValue] },
    //   };
    default:
      throw new Error(`Unexpected part type: ${JSON.stringify(part)}`);
  }
}
