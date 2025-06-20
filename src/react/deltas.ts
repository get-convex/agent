import type { TextPart, ToolCallPart, ToolResultPart } from "ai";
import type { MessageDoc } from "../client/index.js";
import type {
  Message,
  StreamDelta,
  StreamMessage,
  TextStreamPart,
} from "../validators.js";
import type { UIMessage } from "./toUIMessages.js";
import { toUIMessages } from "./toUIMessages.js";

export { toUIMessages, type UIMessage };

export function mergeDeltas(
  threadId: string,
  streamMessages: StreamMessage[],
  existingStreams: Array<{
    streamId: string;
    cursor: number;
    messages: MessageDoc[];
  }>,
  allDeltas: StreamDelta[]
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
      (d) => d.streamId === streamMessage.streamId
    );
    const existing = existingStreams.find(
      (s) => s.streamId === streamMessage.streamId
    );
    const [newStream, messageChanged] = applyDeltasToStreamMessage(
      threadId,
      streamMessage,
      existing,
      deltas
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

// exported for testing
export function applyDeltasToStreamMessage(
  threadId: string,
  streamMessage: StreamMessage,
  existing:
    | { streamId: string; cursor: number; messages: MessageDoc[] }
    | undefined,
  deltas: StreamDelta[]
): [{ streamId: string; cursor: number; messages: MessageDoc[] }, boolean] {
  let changed = false;
  let cursor = existing?.cursor ?? 0;
  let parts: TextStreamPart[] = [];
  for (const delta of deltas.sort((a, b) => a.start - b.start)) {
    if (delta.parts.length === 0) {
      console.warn(`Got delta with no parts: ${JSON.stringify(delta)}`);
      continue;
    }
    if (cursor !== delta.start) {
      if (cursor >= delta.end) {
        console.debug(
          `Got duplicate delta for stream ${delta.streamId} at ${delta.start}`
        );
        continue;
      } else if (cursor < delta.start) {
        console.warn(
          `Got delta for stream ${delta.streamId} that has a gap ${cursor} -> ${delta.start}`
        );
        continue;
      } else {
        throw new Error(
          `Got unexpected delta for stream ${delta.streamId}: delta: ${delta.start} -> ${delta.end} existing cursor: ${cursor}`
        );
      }
    }
    changed = true;
    cursor = delta.end;
    parts.push(...delta.parts);
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
    };
  } else {
    const newMessage = createStreamingMessage(
      threadId,
      streamMessage,
      parts[0]!,
      existingMessages.length
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
      | TextPart
      | ToolCallPart
      | { type: "reasoning"; text: string }
      | ToolResultPart
      | undefined;
    const isToolRole = part.type === "source" || part.type === "tool-result";
    if (isToolRole !== (currentMessage.message!.role === "tool")) {
      currentMessage = createStreamingMessage(
        threadId,
        streamMessage,
        part,
        newStream.messages.length
      );
      lastContent = getLastContent(currentMessage);
      newStream.messages.push(currentMessage);
      continue;
    }
    switch (part.type) {
      case "text-delta":
        currentMessage.text += part.textDelta;
        if (lastContent?.type === "text") {
          lastContent.text += part.textDelta;
        } else {
          contentToAdd = {
            type: "text",
            text: part.textDelta,
          };
        }
        break;
      case "tool-call-streaming-start":
        currentMessage.tool = true;
        contentToAdd = {
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: "",
        };
        break;
      case "tool-call-delta":
        {
          currentMessage.tool = true;
          if (lastContent?.type !== "tool-call") {
            throw new Error("Expected last content to be a tool call");
          }
          if (typeof lastContent.args !== "string") {
            throw new Error("Expected args to be a string");
          }
          lastContent.args += part.argsTextDelta;
        }
        break;
      case "tool-call":
        currentMessage.tool = true;
        contentToAdd = part;
        break;
      case "reasoning":
        currentMessage.reasoning += part.textDelta;
        if (lastContent?.type === "reasoning") {
          lastContent.text += part.textDelta;
        } else {
          contentToAdd = {
            type: "reasoning",
            text: part.textDelta,
          };
        }
        break;
      case "source":
        if (!currentMessage.sources) {
          currentMessage.sources = [];
        }
        currentMessage.sources.push(part.source);
        break;
      case "tool-result":
        contentToAdd = part;
        break;
      default:
        console.warn(`Received unexpected part: ${JSON.stringify(part)}`);
        break;
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

function cloneMessageAndContent(
  message: Message | undefined
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

export function createStreamingMessage(
  threadId: string,
  message: StreamMessage,
  part: TextStreamPart,
  index: number
): MessageDoc {
  const { streamId, ...rest } = message;
  const metadata: MessageDoc = {
    ...rest,
    _id: `${streamId}-${index}`,
    _creationTime: Date.now(),
    status: (
      { streaming: "pending", finished: "success", aborted: "failed" } as const
    )[message.status],
    threadId,
    tool: false,
  };
  switch (part.type) {
    case "text-delta":
      return {
        ...metadata,
        message: {
          role: "assistant",
          content: [{ type: "text", text: part.textDelta }],
        },
        text: part.textDelta,
      };
    case "tool-call-streaming-start":
      return {
        ...metadata,
        tool: true,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: part.toolName,
              toolCallId: part.toolCallId,
              args: "", // when it's a string, it's a partial call
            },
          ],
        },
      };
    case "reasoning":
      return {
        ...metadata,
        message: {
          role: "assistant",
          content: [{ type: "reasoning", text: part.textDelta }],
        },
        reasoning: part.textDelta,
      };
    case "source":
      console.warn("Received source part first??");
      return {
        ...metadata,
        tool: true,
        message: { role: "tool", content: [] },
        sources: [part.source],
      };
    case "tool-call":
      return {
        ...metadata,
        tool: true,
        message: { role: "assistant", content: [part] },
      };
    case "tool-call-delta":
      console.warn("Received tool call delta part first??");
      return {
        ...metadata,
        tool: true,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.argsTextDelta,
            },
          ],
        },
      };
    case "tool-result":
      return {
        ...metadata,
        tool: true,
        message: { role: "tool", content: [part] },
      };
    default:
      throw new Error(`Unexpected part type: ${JSON.stringify(part)}`);
  }
}
