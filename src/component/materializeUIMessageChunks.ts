import type {
  Message,
  MessageContentParts,
  MessageWithMetadataInternal,
  ProviderMetadata,
  StreamDelta,
  StreamMessage,
} from "../validators.js";

type RecordValue = Record<string, unknown>;
type AssistantContentPart = Exclude<
  Extract<Message, { role: "assistant" }>["content"],
  string
>[number];
type ToolContentPart = Extract<Message, { role: "tool" }>["content"][number];

type TextPart = {
  type: "text";
  text: string;
  providerMetadata?: ProviderMetadata;
};

type ReasoningPart = {
  type: "reasoning";
  text: string;
  providerMetadata?: ProviderMetadata;
};

type FilePart = {
  type: "file";
  url: string;
  mediaType: string;
  filename?: string;
};

type SourcePart =
  | {
      type: "source-url";
      sourceId: string;
      url: string;
      title?: string;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "source-document";
      sourceId: string;
      mediaType: string;
      title: string;
      filename?: string;
      providerMetadata?: ProviderMetadata;
    };

type ToolPart = {
  type: `tool-${string}` | "dynamic-tool";
  toolName?: string;
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied";
  input?: unknown;
  rawInput?: unknown;
  output?: unknown;
  errorText?: string;
  providerExecuted?: boolean;
  callProviderMetadata?: ProviderMetadata;
  preliminary?: boolean;
  title?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
};

type DataPart = {
  type: `data-${string}`;
  id?: string;
  data: unknown;
};

type LegacyUIMessagePart =
  | TextPart
  | ReasoningPart
  | FilePart
  | SourcePart
  | ToolPart
  | DataPart
  | { type: "step-start" };

type PartialToolCall = {
  text: string;
  toolName: string;
  dynamic?: boolean;
  title?: string;
};

type StreamMetadata = {
  status: "success" | "failed";
  error?: string;
};

class OrphanToolInvocationError extends Error {}

/**
 * Recover stored messages from persisted AI SDK 5/6 UIMessageChunk rows
 * without loading the AI SDK in the Convex component.
 *
 * UIMessageChunk is a persisted wire format here, not a core Agent type.
 * Keep this decoder pinned to the AI SDK 6 behavior used when these rows were
 * written so a future provider adapter cannot reinterpret existing data.
 */
export function materializeUIMessageChunks(
  stream: StreamMessage,
  chunks: readonly unknown[],
  metadata: StreamMetadata,
): MessageWithMetadataInternal[] {
  if (stream.format !== "UIMessageChunk") {
    throw new Error(
      `materializeUIMessageChunks: unsupported stream format "${stream.format ?? "text"}" for stream ${stream.streamId}`,
    );
  }

  const parts: LegacyUIMessagePart[] = [];
  const activeText: Record<string, TextPart> = {};
  const activeReasoning: Record<string, ReasoningPart> = {};
  const partialToolCalls: Record<string, PartialToolCall> = {};

  const staticToolPart = (toolCallId: string) =>
    parts.find(
      (part): part is ToolPart =>
        isStaticToolPart(part) && part.toolCallId === toolCallId,
    );
  const dynamicToolPart = (toolCallId: string) =>
    parts.find(
      (part): part is ToolPart =>
        part.type === "dynamic-tool" && part.toolCallId === toolCallId,
    );
  const toolPart = (toolCallId: string) =>
    parts.find(
      (part): part is ToolPart =>
        isToolPart(part) && part.toolCallId === toolCallId,
    );

  const updateToolPart = (
    dynamic: boolean,
    options: Omit<ToolPart, "type"> & {
      toolName: string;
      setCallProviderMetadataOnExisting?: boolean;
    },
  ) => {
    const existing = dynamic
      ? dynamicToolPart(options.toolCallId)
      : staticToolPart(options.toolCallId);
    if (existing) {
      existing.state = options.state;
      existing.input = options.input;
      existing.rawInput = options.rawInput;
      existing.output = options.output;
      existing.errorText = options.errorText;
      existing.preliminary = options.preliminary;
      existing.providerExecuted =
        options.providerExecuted ?? existing.providerExecuted;
      if (options.title !== undefined) existing.title = options.title;
      if (
        options.setCallProviderMetadataOnExisting &&
        options.callProviderMetadata !== undefined
      ) {
        existing.callProviderMetadata = options.callProviderMetadata;
      }
      if (dynamic) existing.toolName = options.toolName;
      return existing;
    }

    const created: ToolPart = {
      type: dynamic ? "dynamic-tool" : `tool-${options.toolName}`,
      toolName: dynamic ? options.toolName : undefined,
      toolCallId: options.toolCallId,
      state: options.state,
      input: options.input,
      rawInput: options.rawInput,
      output: options.output,
      errorText: options.errorText,
      preliminary: options.preliminary,
      providerExecuted: options.providerExecuted,
      callProviderMetadata: options.callProviderMetadata,
      title: options.title,
    };
    parts.push(created);
    return created;
  };

  try {
    for (const value of chunks) {
      const chunk = chunkRecord(value);
      switch (chunk.type) {
        case "text-start": {
          const part: TextPart = {
            type: "text",
            text: "",
            providerMetadata: providerMetadata(chunk.providerMetadata),
          };
          activeText[stringField(chunk, "id")] = part;
          parts.push(part);
          break;
        }
        case "text-delta": {
          const id = stringField(chunk, "id");
          const part = activeText[id];
          if (!part) {
            throw new Error(
              `Received text-delta for missing text part with ID "${id}".`,
            );
          }
          part.text += stringField(chunk, "delta");
          part.providerMetadata =
            providerMetadata(chunk.providerMetadata) ?? part.providerMetadata;
          break;
        }
        case "text-end": {
          const id = stringField(chunk, "id");
          const part = activeText[id];
          if (!part) {
            throw new Error(
              `Received text-end for missing text part with ID "${id}".`,
            );
          }
          part.providerMetadata =
            providerMetadata(chunk.providerMetadata) ?? part.providerMetadata;
          delete activeText[id];
          break;
        }
        case "reasoning-start": {
          const part: ReasoningPart = {
            type: "reasoning",
            text: "",
            providerMetadata: providerMetadata(chunk.providerMetadata),
          };
          activeReasoning[stringField(chunk, "id")] = part;
          parts.push(part);
          break;
        }
        case "reasoning-delta": {
          const id = stringField(chunk, "id");
          const part = activeReasoning[id];
          if (!part) {
            throw new Error(
              `Received reasoning-delta for missing reasoning part with ID "${id}".`,
            );
          }
          part.text += stringField(chunk, "delta");
          part.providerMetadata =
            providerMetadata(chunk.providerMetadata) ?? part.providerMetadata;
          break;
        }
        case "reasoning-end": {
          const id = stringField(chunk, "id");
          const part = activeReasoning[id];
          if (!part) {
            throw new Error(
              `Received reasoning-end for missing reasoning part with ID "${id}".`,
            );
          }
          part.providerMetadata =
            providerMetadata(chunk.providerMetadata) ?? part.providerMetadata;
          delete activeReasoning[id];
          break;
        }
        case "file":
          parts.push({
            type: "file",
            url: stringField(chunk, "url"),
            mediaType: stringField(chunk, "mediaType"),
          });
          break;
        case "source-url":
          parts.push({
            type: "source-url",
            sourceId: stringField(chunk, "sourceId"),
            url: stringField(chunk, "url"),
            title: optionalString(chunk.title),
            providerMetadata: providerMetadata(chunk.providerMetadata),
          });
          break;
        case "source-document":
          parts.push({
            type: "source-document",
            sourceId: stringField(chunk, "sourceId"),
            mediaType: stringField(chunk, "mediaType"),
            title: stringField(chunk, "title"),
            filename: optionalString(chunk.filename),
            providerMetadata: providerMetadata(chunk.providerMetadata),
          });
          break;
        case "tool-input-start": {
          const toolCallId = stringField(chunk, "toolCallId");
          const toolName = stringField(chunk, "toolName");
          const dynamic = chunk.dynamic === true;
          partialToolCalls[toolCallId] = {
            text: "",
            toolName,
            dynamic,
            title: optionalString(chunk.title),
          };
          updateToolPart(dynamic, {
            toolCallId,
            toolName,
            state: "input-streaming",
            input: undefined,
            providerExecuted: optionalBoolean(chunk.providerExecuted),
            title: optionalString(chunk.title),
          });
          break;
        }
        case "tool-input-delta": {
          const toolCallId = stringField(chunk, "toolCallId");
          const partial = partialToolCalls[toolCallId];
          if (!partial) {
            throw new Error(
              `Received tool-input-delta for missing tool call with ID "${toolCallId}".`,
            );
          }
          partial.text += stringField(chunk, "inputTextDelta");
          updateToolPart(partial.dynamic === true, {
            toolCallId,
            toolName: partial.toolName,
            state: "input-streaming",
            input: parseCompleteJson(partial.text),
            title: partial.title,
          });
          break;
        }
        case "tool-input-available": {
          const dynamic = chunk.dynamic === true;
          updateToolPart(dynamic, {
            toolCallId: stringField(chunk, "toolCallId"),
            toolName: stringField(chunk, "toolName"),
            state: "input-available",
            input: chunk.input,
            providerExecuted: optionalBoolean(chunk.providerExecuted),
            callProviderMetadata: providerMetadata(chunk.providerMetadata),
            setCallProviderMetadataOnExisting: true,
            title: optionalString(chunk.title),
          });
          break;
        }
        case "tool-input-error": {
          const dynamic = chunk.dynamic === true;
          updateToolPart(dynamic, {
            toolCallId: stringField(chunk, "toolCallId"),
            toolName: stringField(chunk, "toolName"),
            state: "output-error",
            input: dynamic ? chunk.input : undefined,
            rawInput: dynamic ? undefined : chunk.input,
            errorText: stringField(chunk, "errorText"),
            providerExecuted: optionalBoolean(chunk.providerExecuted),
            callProviderMetadata: providerMetadata(chunk.providerMetadata),
            title: optionalString(chunk.title),
          });
          break;
        }
        case "tool-approval-request": {
          const invocation = requireToolPart(
            toolPart(stringField(chunk, "toolCallId")),
            stringField(chunk, "toolCallId"),
          );
          invocation.state = "approval-requested";
          invocation.approval = { id: stringField(chunk, "approvalId") };
          break;
        }
        case "tool-approval-response":
          throw new Error(
            'materializeUIMessageChunks: persisted chunk type "tool-approval-response" is not part of the pinned AI SDK 6.0.35 UIMessageChunk wire format',
          );
        case "tool-output-denied": {
          const invocation = requireToolPart(
            toolPart(stringField(chunk, "toolCallId")),
            stringField(chunk, "toolCallId"),
          );
          invocation.state = "output-denied";
          break;
        }
        case "tool-output-available": {
          const toolCallId = stringField(chunk, "toolCallId");
          const invocation = requireToolPart(toolPart(toolCallId), toolCallId);
          updateToolPart(invocation.type === "dynamic-tool", {
            toolCallId,
            toolName: getToolName(invocation),
            state: "output-available",
            input: invocation.input,
            output: chunk.output,
            preliminary: optionalBoolean(chunk.preliminary),
            providerExecuted: optionalBoolean(chunk.providerExecuted),
            title: invocation.title,
          });
          break;
        }
        case "tool-output-error": {
          const toolCallId = stringField(chunk, "toolCallId");
          const invocation = requireToolPart(toolPart(toolCallId), toolCallId);
          updateToolPart(invocation.type === "dynamic-tool", {
            toolCallId,
            toolName: getToolName(invocation),
            state: "output-error",
            input: invocation.input,
            rawInput: invocation.rawInput,
            errorText: stringField(chunk, "errorText"),
            providerExecuted: optionalBoolean(chunk.providerExecuted),
            title: invocation.title,
          });
          break;
        }
        case "start-step":
          parts.push({ type: "step-start" });
          break;
        case "finish-step":
          for (const id of Object.keys(activeText)) delete activeText[id];
          for (const id of Object.keys(activeReasoning)) {
            delete activeReasoning[id];
          }
          break;
        case "error":
          throw new Error(stringField(chunk, "errorText"));
        case "start": {
          const messageId = optionalString(chunk.messageId);
          if (
            messageId !== undefined &&
            messageId !== `stream:${stream.streamId}`
          ) {
            throw new Error("Expecting to only make one UIMessage in a stream");
          }
          break;
        }
        case "finish":
        case "abort":
        case "message-metadata":
          break;
        default:
          if (chunk.type.startsWith("data-") && chunk.transient !== true) {
            const id = optionalString(chunk.id);
            const existing = id
              ? parts.find(
                  (part): part is DataPart =>
                    part.type === chunk.type && "id" in part && part.id === id,
                )
              : undefined;
            if (existing) {
              existing.data = chunk.data;
            } else {
              parts.push({
                type: chunk.type as `data-${string}`,
                id,
                data: chunk.data,
              });
            }
          }
          break;
      }
    }
  } catch (error) {
    // AI SDK 6's recovery path deliberately tolerates a continuation stream
    // whose tool invocation was persisted in an earlier stream. It returns the
    // materialized prefix and ignores the remaining chunks.
    if (!(error instanceof OrphanToolInvocationError)) throw error;
  }

  return partsToMessages(parts, stream, metadata);
}

export function getPersistedStreamParts(
  deltas: readonly StreamDelta[],
  fromCursor = 0,
): { parts: unknown[]; cursor: number } {
  const parts: unknown[] = [];
  let cursor = fromCursor;
  for (const delta of [...deltas].sort((a, b) => a.start - b.start)) {
    if (delta.parts.length === 0) {
      console.debug(`Got delta with no parts: ${JSON.stringify(delta)}`);
      continue;
    }
    if (cursor !== delta.start) {
      if (cursor >= delta.end) continue;
      if (cursor < delta.start) {
        console.warn(
          `Got delta for stream ${delta.streamId} that has a gap ${cursor} -> ${delta.start}`,
        );
        break;
      }
      throw new Error(
        `Got unexpected delta for stream ${delta.streamId}: delta: ${delta.start} -> ${delta.end} existing cursor: ${cursor}`,
      );
    }
    parts.push(...delta.parts);
    cursor = delta.end;
  }
  return { parts, cursor };
}

function partsToMessages(
  parts: LegacyUIMessagePart[],
  stream: StreamMessage,
  metadata: StreamMetadata,
): MessageWithMetadataInternal[] {
  const sources = parts
    .filter((part): part is SourcePart =>
      ["source-url", "source-document"].includes(part.type),
    )
    .map((part) =>
      part.type === "source-url"
        ? {
            type: "source" as const,
            sourceType: "url" as const,
            url: part.url,
            id: part.sourceId,
            providerMetadata: part.providerMetadata,
            title: part.title,
          }
        : {
            type: "source" as const,
            sourceType: "document" as const,
            mediaType: part.mediaType,
            id: part.sourceId,
            providerMetadata: part.providerMetadata,
            title: part.title,
          },
    );

  const blocks: LegacyUIMessagePart[][] = [];
  let block: LegacyUIMessagePart[] = [];
  const flush = () => {
    if (block.length > 0) blocks.push(block);
    block = [];
  };
  for (const part of parts) {
    if (part.type === "step-start") {
      flush();
    } else if (
      part.type === "text" ||
      part.type === "reasoning" ||
      part.type === "file" ||
      isToolPart(part) ||
      part.type.startsWith("data-")
    ) {
      block.push(part);
    }
  }
  flush();

  const messages: Message[] = [];
  for (const current of blocks) {
    const assistantContent: AssistantContentPart[] = [];
    const tools = current.filter(isToolPart);

    for (const part of current) {
      if (part.type === "text") {
        assistantContent.push({
          type: "text",
          text: part.text,
          ...(part.providerMetadata
            ? { providerOptions: part.providerMetadata }
            : {}),
        });
      } else if (part.type === "reasoning") {
        assistantContent.push({
          type: "reasoning",
          text: part.text,
          ...(part.providerMetadata
            ? { providerOptions: part.providerMetadata }
            : {}),
        });
      } else if (part.type === "file") {
        assistantContent.push({
          type: "file",
          data: part.url,
          filename: part.filename,
          mediaType: part.mediaType,
        });
      } else if (isToolPart(part) && part.state !== "input-streaming") {
        const input =
          part.state === "output-error"
            ? (part.input ?? part.rawInput ?? {})
            : (part.input ?? {});
        assistantContent.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: getToolName(part),
          input,
          args: input,
          providerExecuted: part.providerExecuted,
          ...(part.callProviderMetadata
            ? { providerOptions: part.callProviderMetadata }
            : {}),
        });
        if (part.approval) {
          assistantContent.push({
            type: "tool-approval-request",
            approvalId: part.approval.id,
            toolCallId: part.toolCallId,
          });
        }
        if (
          part.providerExecuted === true &&
          part.state !== "approval-responded" &&
          (part.state === "output-available" || part.state === "output-error")
        ) {
          assistantContent.push(
            toolResult(
              part,
              part.state === "output-error" ? "error-json" : "normal",
            ),
          );
        }
      }
    }
    if (assistantContent.length > 0) {
      messages.push({ role: "assistant", content: assistantContent });
    }

    const toolContent: ToolContentPart[] = [];
    for (const part of tools) {
      if (part.approval?.approved !== undefined) {
        toolContent.push({
          type: "tool-approval-response",
          approvalId: part.approval.id,
          approved: part.approval.approved,
          reason: part.approval.reason,
          providerExecuted: part.providerExecuted,
        });
      }
      if (part.providerExecuted === true) continue;
      if (part.state === "output-denied") {
        // Deliberately access approval like AI SDK 6: a denied chunk without a
        // preceding approval request is malformed rather than silently fixed.
        const reason = part.approval!.reason ?? "Tool execution denied.";
        toolContent.push(toolResult(part, "denied", reason));
      } else if (part.state === "output-error") {
        toolContent.push(toolResult(part, "error-text"));
      } else if (part.state === "output-available") {
        toolContent.push(toolResult(part, "normal"));
      }
    }
    if (toolContent.length > 0) {
      messages.push({ role: "tool", content: toolContent });
    }
  }

  return messages.map((message) => {
    const content = Array.isArray(message.content) ? message.content : [];
    const providerMetadataValue = content.find(
      (part) => part.providerOptions !== undefined,
    )?.providerOptions;
    const hasToolCall =
      message.role === "tool" ||
      content.some((part) => part.type === "tool-call");
    return {
      message,
      status: metadata.status,
      finishReason: hasToolCall ? "tool-calls" : "stop",
      model: stream.model,
      provider: stream.provider,
      ...(providerMetadataValue
        ? { providerMetadata: providerMetadataValue }
        : {}),
      sources,
      reasoning: content
        .filter(
          (part): part is Extract<MessageContentParts, { type: "reasoning" }> =>
            part.type === "reasoning",
        )
        .map((part) => part.text)
        .join(" "),
      ...(metadata.error !== undefined ? { error: metadata.error } : {}),
    } satisfies MessageWithMetadataInternal;
  });
}

function toolResult(
  part: ToolPart,
  mode: "normal" | "error-text" | "error-json" | "denied",
  deniedReason?: string,
): Extract<MessageContentParts, { type: "tool-result" }> {
  const raw =
    mode === "denied"
      ? deniedReason
      : part.state === "output-error"
        ? part.errorText
        : part.output;
  const output =
    mode === "error-text" || mode === "denied"
      ? { type: "error-text" as const, value: String(raw) }
      : mode === "error-json"
        ? { type: "error-json" as const, value: raw ?? null }
        : typeof raw === "string"
          ? { type: "text" as const, value: raw }
          : { type: "json" as const, value: raw ?? null };
  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: getToolName(part),
    output,
    ...(part.callProviderMetadata
      ? { providerOptions: part.callProviderMetadata }
      : {}),
  };
}

function chunkRecord(value: unknown): RecordValue & { type: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted UIMessageChunk");
  }
  const record = value as RecordValue;
  if (typeof record.type !== "string") {
    throw new Error("Persisted UIMessageChunk is missing a type");
  }
  return record as RecordValue & { type: string };
}

function stringField(record: RecordValue, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Persisted UIMessageChunk field ${field} must be a string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function providerMetadata(value: unknown): ProviderMetadata | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ProviderMetadata)
    : undefined;
}

function isToolPart(part: LegacyUIMessagePart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function isStaticToolPart(part: LegacyUIMessagePart): part is ToolPart {
  return part.type.startsWith("tool-");
}

function getToolName(part: ToolPart): string {
  return part.type === "dynamic-tool"
    ? part.toolName!
    : part.type.split("-").slice(1).join("-");
}

function requireToolPart(
  part: ToolPart | undefined,
  toolCallId: string,
): ToolPart {
  if (!part) {
    throw new OrphanToolInvocationError(
      `No tool invocation found for tool call ID "${toolCallId}".`,
    );
  }
  return part;
}

function parseCompleteJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
