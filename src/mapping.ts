import {
  convertToCoreMessages,
  coreMessageSchema,
  GenerateObjectResult,
  type AssistantContent,
  type CoreMessage,
  type DataContent,
  type StepResult,
  type ToolContent,
  type ToolSet,
  type Message as AIMessage,
  type UserContent,
} from "ai";
import { assert } from "convex-helpers";
import {
  MessageWithMetadata,
  Step,
  StepWithMessagesWithMetadata,
} from "./validators";

export type AIMessageWithoutId = Omit<AIMessage, "id">;

export type SerializeUrlsAndUint8Arrays<T> = T extends URL
  ? string
  : T extends Uint8Array | ArrayBufferLike
    ? ArrayBuffer
    : T extends Array<infer Inner>
      ? Array<SerializeUrlsAndUint8Arrays<Inner>>
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        T extends Record<string, any>
        ? { [K in keyof T]: SerializeUrlsAndUint8Arrays<T[K]> }
        : T;

export type Content = UserContent | AssistantContent | ToolContent;
export type SerializedContent = SerializeUrlsAndUint8Arrays<Content>;

export type SerializedMessage = SerializeUrlsAndUint8Arrays<CoreMessage>;

export function serializeMessage(
  messageWithId: CoreMessage & { id?: string }
): SerializedMessage {
  const { id: _, ...message } = messageWithId;
  const content = message.content;
  return {
    ...message,
    content: serializeContent(content),
  } as SerializedMessage;
}

export function serializeMessageWithId(
  messageWithId: CoreMessage & { id?: string }
): { message: SerializedMessage; id: string | undefined } {
  return { message: serializeMessage(messageWithId), id: messageWithId.id };
}

export function deserializeMessage(message: SerializedMessage): CoreMessage {
  return {
    ...message,
    content: deserializeContent(message.content),
  } as CoreMessage;
}

export function serializeStep<TOOLS extends ToolSet>(
  step: StepResult<TOOLS>
): Step {
  const content = step.response?.messages.map((message) => {
    return serializeMessageWithId(message);
  });
  const timestamp = step.response?.timestamp.getTime();
  const response = {
    ...step.response,
    messages: content,
    timestamp,
    headers: {}, // these are large and low value
  };
  return {
    ...step,
    response,
  };
}

export function serializeNewMessagesInStep<TOOLS extends ToolSet>(
  step: StepResult<TOOLS>,
  metadata: { model: string; provider: string }
): MessageWithMetadata[] {
  // If there are tool results, there's another message with the tool results
  // ref: https://github.com/vercel/ai/blob/main/packages/ai/core/generate-text/to-response-messages.ts
  const assistantFields = {
    model: metadata.model,
    provider: metadata.provider,
    providerMetadata: step.providerMetadata,
    reasoning: step.reasoning,
    usage: step.usage,
    warnings: step.warnings,
    finishReason: step.finishReason,
  };
  const toolFields = {
    sources: step.sources,
  };
  const messages: MessageWithMetadata[] = (
    step.toolResults.length > 0
      ? step.response.messages.slice(-2)
      : step.response.messages.slice(-1)
  ).map((message) => ({
    message: serializeMessage(message),
    id: message.id,
    ...(message.role === "tool" ? toolFields : assistantFields),
    // fileId: message.fileId,
  }));
  return messages;
}

export function serializeObjectResult(
  step: GenerateObjectResult<unknown>,
  metadata: { model: string; provider: string }
): StepWithMessagesWithMetadata {
  const text = JSON.stringify(step.object);

  return {
    messages: [
      {
        message: { role: "assistant" as const, content: text },
        id: step.response.id,
        model: metadata.model,
        provider: metadata.provider,
        providerMetadata: step.providerMetadata,
        finishReason: step.finishReason,
        text,
        usage: step.usage,
        warnings: step.warnings,
      },
    ],
    step: {
      text,
      isContinued: false,
      stepType: "initial",
      toolCalls: [],
      toolResults: [],
      usage: step.usage,
      warnings: step.warnings,
      finishReason: step.finishReason,
      request: step.request,
      response: {
        ...step.response,
        timestamp: step.response.timestamp.getTime(),
        messages: [
          serializeMessageWithId({
            role: "assistant" as const,
            content: text,
            id: step.response.id,
          }),
        ],
      },
      providerMetadata: step.providerMetadata,
      experimental_providerMetadata: step.experimental_providerMetadata,
    },
  };
}

export function serializeContent(content: Content): SerializedContent {
  if (typeof content === "string") {
    return content;
  }
  const serialized = content.map((part) => {
    switch (part.type) {
      case "image":
        return { ...part, image: serializeDataOrUrl(part.image) };
      case "file":
        return { ...part, file: serializeDataOrUrl(part.data) };
      default:
        return part;
    }
  });
  return serialized as SerializedContent;
}

export function deserializeContent(content: SerializedContent): Content {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => {
    switch (part.type) {
      case "image":
        return { ...part, image: deserializeUrl(part.image) };
      case "file":
        return { ...part, file: deserializeUrl(part.data) };
      default:
        return part;
    }
  }) as Content;
}

// TODO: store in file storage if it's big
function serializeDataOrUrl(
  dataOrUrl: DataContent | URL
): ArrayBuffer | string {
  if (typeof dataOrUrl === "string") {
    return dataOrUrl;
  }
  if (dataOrUrl instanceof ArrayBuffer) {
    return dataOrUrl; // Already an ArrayBuffer
  }
  if (dataOrUrl instanceof URL) {
    return dataOrUrl.toString();
  }
  return dataOrUrl.buffer.slice(
    dataOrUrl.byteOffset,
    dataOrUrl.byteOffset + dataOrUrl.byteLength
  ) as ArrayBuffer;
}

function deserializeUrl(urlOrString: string | ArrayBuffer): URL | DataContent {
  if (typeof urlOrString === "string") {
    if (
      urlOrString.startsWith("http://") ||
      urlOrString.startsWith("https://")
    ) {
      return new URL(urlOrString);
    }
    return urlOrString;
  }
  return urlOrString;
}

export function promptOrMessagesToCoreMessages(args: {
  prompt?: string;
  messages?: CoreMessage[] | AIMessageWithoutId[];
}): CoreMessage[] {
  const messages: CoreMessage[] = [];
  assert(args.prompt || args.messages, "messages or prompt is required");
  if (args.messages) {
    if (
      args.messages.some(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m.role === "data" || // UI-only role
            "toolInvocations" in m || // UI-specific field
            "parts" in m || // UI-specific field
            "experimental_attachments" in m)
      )
    ) {
      messages.push(...convertToCoreMessages(args.messages as AIMessage[]));
    } else {
      messages.push(...coreMessageSchema.array().parse(args.messages));
    }
  }
  if (args.prompt) {
    messages.push({ role: "user", content: args.prompt });
  }
  assert(messages.length > 0, "Messages must contain at least one message");
  return messages;
}
