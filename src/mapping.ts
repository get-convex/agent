import {
  type UIMessage as AIMessage,
  type AssistantContent,
  type ModelMessage,
  type DataContent,
  type FilePart,
  type GenerateObjectResult,
  type ImagePart,
  type StepResult,
  type ToolContent,
  type ToolSet,
  type UserContent,
  type FileUIPart,
  type LanguageModelUsage,
  type CallWarning,
  type TextPart,
  type ToolCallPart,
  type ToolResultPart,
  type ReasoningUIPart,
} from "ai";
import type {
  Message,
  MessageWithMetadata,
  Usage,
  vContent,
  vFilePart,
  vImagePart,
  vReasoningPart,
  vTextPart,
  vToolCallPart,
  vToolResultPart,
} from "./validators.js";
import type { ActionCtx, AgentComponent } from "./client/types.js";
import type { RunMutationCtx } from "./client/types.js";
import { MAX_FILE_SIZE, storeFile } from "./client/files.js";
import type { Infer } from "convex/values";

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
export type SerializedContent = Message["content"];

export type SerializedMessage = Message;

export async function serializeMessage(
  ctx: ActionCtx | RunMutationCtx,
  component: AgentComponent,
  messageWithId: ModelMessage & { id?: string },
): Promise<{ message: SerializedMessage; fileIds?: string[] }> {
  const { id: _, ...message } = messageWithId;
  const { content, fileIds } = await serializeContent(
    ctx,
    component,
    message.content,
  );
  return {
    message: {
      ...message,
      content,
    } as SerializedMessage,
    fileIds,
  };
}

export function deserializeMessage(message: SerializedMessage): ModelMessage {
  return {
    ...message,
    content: deserializeContent(message.content),
  } as ModelMessage;
}

export function serializeUsage(usage: LanguageModelUsage): Usage {
  return {
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    reasoningTokens: usage.reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
  };
}

export function deserializeUsage(usage: Usage): LanguageModelUsage {
  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
  };
}

export function serializeWarnings(
  warnings: CallWarning[] | undefined,
): MessageWithMetadata["warnings"] {
  if (!warnings) {
    return undefined;
  }
  return warnings.map((warning) => {
    if (warning.type !== "unsupported-setting") {
      return warning;
    }
    return {
      ...warning,
      setting: JSON.stringify(warning.setting),
    };
  });
}

export function deserializeWarnings(
  warnings: MessageWithMetadata["warnings"],
): CallWarning[] | undefined {
  if (!warnings) {
    return undefined;
  }
  return warnings.map((warning) => {
    if (warning.type !== "unsupported-setting") {
      return warning;
    }
    return {
      ...warning,
      setting: JSON.parse(warning.setting),
    };
  });
}

export async function serializeNewMessagesInStep<TOOLS extends ToolSet>(
  ctx: ActionCtx,
  component: AgentComponent,
  step: StepResult<TOOLS>,
  metadata: { model: string; provider: string },
): Promise<MessageWithMetadata[]> {
  // If there are tool results, there's another message with the tool results
  // ref: https://github.com/vercel/ai/blob/main/packages/ai/core/generate-text/to-response-messages.ts
  const assistantFields = {
    model: metadata.model,
    provider: metadata.provider,
    providerMetadata: step.providerMetadata,
    reasoning: step.reasoningText,
    reasoningDetails: step.reasoning,
    usage: serializeUsage(step.usage),
    warnings: serializeWarnings(step.warnings),
    finishReason: step.finishReason,
    // Only store the sources on one message
    sources: step.toolResults.length === 0 ? step.sources : undefined,
  } satisfies Omit<MessageWithMetadata, "message" | "text" | "fileIds">;
  const toolFields = {
    sources: step.sources,
  };
  const messages: MessageWithMetadata[] = await Promise.all(
    (step.toolResults.length > 0
      ? step.response.messages.slice(-2)
      : step.response.messages.slice(-1)
    ).map(async (messageWithId): Promise<MessageWithMetadata> => {
      const { message, fileIds } = await serializeMessage(
        ctx,
        component,
        messageWithId,
      );
      return {
        message,
        // Let's not store the ID by default here. It's being generated internally
        // and not referenced elsewhere that we know of.
        // id: message.id,
        ...(message.role === "tool" ? toolFields : assistantFields),
        text: step.text,
        fileIds,
      };
    }),
  );
  return messages;
}

export async function serializeObjectResult(
  ctx: ActionCtx,
  component: AgentComponent,
  result: GenerateObjectResult<unknown>,
  metadata: { model: string; provider: string },
): Promise<{ messages: MessageWithMetadata[] }> {
  const text = JSON.stringify(result.object);

  const { message, fileIds } = await serializeMessage(ctx, component, {
    role: "assistant" as const,
    content: text,
  });
  return {
    messages: [
      {
        message,
        id: result.response.id,
        model: metadata.model,
        provider: metadata.provider,
        providerMetadata: result.providerMetadata,
        finishReason: result.finishReason,
        text,
        usage: serializeUsage(result.usage),
        warnings: serializeWarnings(result.warnings),
        fileIds,
      },
    ],
  };
}

export async function serializeContent(
  ctx: ActionCtx | RunMutationCtx,
  component: AgentComponent,
  content: Content,
): Promise<{ content: SerializedContent; fileIds?: string[] }> {
  if (typeof content === "string") {
    return { content };
  }
  const fileIds: string[] = [];
  const serialized = await Promise.all(
    content.map(async (part) => {
      switch (part.type) {
        case "text": {
          return {
            type: part.type,
            text: part.text,
            providerOptions: part.providerOptions,
          } satisfies Infer<typeof vTextPart>;
        }
        case "image": {
          let image = serializeDataOrUrl(part.image);
          if (
            image instanceof ArrayBuffer &&
            image.byteLength > MAX_FILE_SIZE
          ) {
            const { file } = await storeFile(
              ctx,
              component,
              new Blob([image], {
                type: part.mediaType || guessMimeType(image),
              }),
            );
            image = file.url;
            fileIds.push(file.fileId);
          }
          return {
            type: part.type,
            mimeType: part.mediaType,
            providerOptions: part.providerOptions,
            image,
          } satisfies Infer<typeof vImagePart>;
        }
        case "file": {
          let data = serializeDataOrUrl(part.data);
          if (data instanceof ArrayBuffer && data.byteLength > MAX_FILE_SIZE) {
            const { file } = await storeFile(
              ctx,
              component,
              new Blob([data], { type: part.mediaType }),
            );
            data = file.url;
            fileIds.push(file.fileId);
          }
          return {
            type: part.type,
            data,
            filename: part.filename,
            mimeType: part.mediaType,
            providerOptions: part.providerOptions,
          } satisfies Infer<typeof vFilePart>;
        }
        case "tool-call": {
          return {
            type: part.type,
            args: part.input ?? null,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            providerOptions: part.providerOptions,
            providerExecuted: part.providerExecuted,
          } satisfies Infer<typeof vToolCallPart>;
        }
        case "tool-result": {
          return {
            type: part.type,
            result: part.output ?? null,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            providerOptions: part.providerOptions,
          } satisfies Infer<typeof vToolResultPart>;
        }
        case "reasoning": {
          return {
            type: part.type,
            text: part.text,
            providerOptions: part.providerOptions,
          } satisfies Infer<typeof vReasoningPart>;
        }
        default:
          return part satisfies Infer<typeof vContent>;
      }
    }),
  );
  return {
    content: serialized as SerializedContent,
    fileIds: fileIds.length > 0 ? fileIds : undefined,
  };
}

export function deserializeContent(content: SerializedContent): Content {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => {
    switch (part.type) {
      case "text":
        return {
          type: part.type,
          text: part.text,
          providerOptions: part.providerOptions,
        } satisfies TextPart;
      case "image":
        return {
          type: part.type,
          image: deserializeUrl(part.image),
          mediaType: part.mimeType,
          providerOptions: part.providerOptions,
        } satisfies ImagePart;
      case "file":
        return {
          type: part.type,
          data: deserializeUrl(part.data),
          filename: part.filename,
          mediaType: part.mimeType,
          providerOptions: part.providerOptions,
        } satisfies FilePart;
      case "tool-call":
        return {
          type: part.type,
          input: part.args ?? null,
          providerExecuted: part.providerExecuted,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          providerOptions: part.providerOptions,
        } satisfies ToolCallPart;
      case "tool-result":
        return {
          type: part.type,
          output: part.result ?? null,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          providerOptions: part.providerOptions,
        } satisfies ToolResultPart;
      case "reasoning":
        return {
          type: part.type,
          text: part.text,
          providerMetadata: part.providerOptions,
          state: part.state,
        } satisfies ReasoningUIPart;
      case "redacted-reasoning":
        // TODO: should we just drop this?
        return {
          type: "reasoning",
          text: part.data,
          providerMetadata: part.providerOptions,
        } satisfies ReasoningUIPart;
      default:
        return part satisfies Content;
    }
  }) as Content;
}

/**
 * Return a best-guess MIME type based on the magic-number signature
 * found at the start of an ArrayBuffer.
 *
 * @param buf – the source ArrayBuffer
 * @returns the detected MIME type, or `"application/octet-stream"` if unknown
 */
export function guessMimeType(buf: ArrayBuffer | string): string {
  if (typeof buf === "string") {
    if (buf.match(/^data:\w+\/\w+;base64/)) {
      return buf.split(";")[0].split(":")[1]!;
    }
    return "text/plain";
  }
  if (buf.byteLength < 4) return "application/octet-stream";

  // Read the first 12 bytes (enough for all signatures below)
  const bytes = new Uint8Array(buf.slice(0, 12));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Helper so we can look at only the needed prefix
  const startsWith = (sig: string) => hex.startsWith(sig.toLowerCase());

  // --- image formats ---
  if (startsWith("89504e47")) return "image/png"; // PNG  - 89 50 4E 47
  if (
    startsWith("ffd8ffdb") ||
    startsWith("ffd8ffe0") ||
    startsWith("ffd8ffee") ||
    startsWith("ffd8ffe1")
  )
    return "image/jpeg"; // JPEG
  if (startsWith("47494638")) return "image/gif"; // GIF
  if (startsWith("424d")) return "image/bmp"; // BMP
  if (startsWith("52494646") && hex.substr(16, 8) === "57454250")
    return "image/webp"; // WEBP (RIFF....WEBP)
  if (startsWith("49492a00")) return "image/tiff"; // TIFF
  // <svg in hex is 3c 3f 78 6d 6c
  if (startsWith("3c737667")) return "image/svg+xml"; // <svg
  if (startsWith("3c3f786d")) return "image/svg+xml"; // <?xm

  // --- audio/video ---
  if (startsWith("494433")) return "audio/mpeg"; // MP3 (ID3)
  if (startsWith("000001ba") || startsWith("000001b3")) return "video/mpeg"; // MPEG container
  if (startsWith("1a45dfa3")) return "video/webm"; // WEBM / Matroska
  if (startsWith("00000018") && hex.substr(16, 8) === "66747970")
    return "video/mp4"; // MP4
  if (startsWith("4f676753")) return "audio/ogg"; // OGG / Opus

  // --- documents & archives ---
  if (startsWith("25504446")) return "application/pdf"; // PDF
  if (
    startsWith("504b0304") ||
    startsWith("504b0506") ||
    startsWith("504b0708")
  )
    return "application/zip"; // ZIP / DOCX / PPTX / XLSX / EPUB
  if (startsWith("52617221")) return "application/x-rar-compressed"; // RAR
  if (startsWith("7f454c46")) return "application/x-elf"; // ELF binaries
  if (startsWith("1f8b08")) return "application/gzip"; // GZIP
  if (startsWith("425a68")) return "application/x-bzip2"; // BZIP2
  if (startsWith("3c3f786d6c")) return "application/xml"; // XML

  // Plain text, JSON and others are trickier—fallback:
  return "application/octet-stream";
}

/**
 * Serialize an AI SDK `DataContent` or `URL` to a Convex-serializable format.
 * @param dataOrUrl - The data or URL to serialize.
 * @returns The serialized data as an ArrayBuffer or the URL as a string.
 */
export function serializeDataOrUrl(
  dataOrUrl: DataContent | URL,
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
    dataOrUrl.byteOffset + dataOrUrl.byteLength,
  ) as ArrayBuffer;
}

export function deserializeUrl(
  urlOrString: string | ArrayBuffer,
): URL | DataContent {
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

export function toUIFilePart(part: ImagePart | FilePart): FileUIPart {
  const dataOrUrl = part.type === "image" ? part.image : part.data;
  const url =
    dataOrUrl instanceof ArrayBuffer
      ? encodeBase64(dataOrUrl)
      : dataOrUrl.toString();

  return {
    type: "file",
    mediaType: part.mediaType!,
    filename: part.type === "file" ? part.filename : undefined,
    url,
    providerMetadata: part.providerOptions,
  };
}

function encodeBase64(data: ArrayBuffer): string {
  return Buffer.from(data).toString("base64");
}

// Currently unused
// export function toModelMessages(args: {
//   messages?: ModelMessage[] | AIMessageWithoutId[];
// }): ModelMessage[] {
//   const messages: ModelMessage[] = [];
//   if (args.messages) {
//     if (
//       args.messages.every(
//         (m) => typeof m === "object" && m !== null && "parts" in m,
//       )
//     ) {
//       messages.push(...convertToModelMessages(args.messages));
//     } else {
//       messages.push(...modelMessageSchema.array().parse(args.messages));
//     }
//   }
//   return messages;
// }
