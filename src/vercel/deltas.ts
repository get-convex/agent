import {
  readUIMessageStream,
  type DynamicToolUIPart,
  type ProviderMetadata,
  type ReasoningUIPart,
  type TextUIPart,
  type ToolUIPart,
  type UIMessageChunk,
} from "ai";
import { assert } from "convex-helpers";
import { type UIMessage } from "./UIMessages.js";
import { joinText, sorted } from "../shared.js";
import {
  type MessageStatus,
  type StreamDelta,
  type StreamMessage,
} from "../validators.js";

export function blankUIMessage<METADATA = unknown>(
  streamMessage: StreamMessage & { metadata?: METADATA },
  threadId: string,
): UIMessage<METADATA> {
  return {
    id: `stream:${streamMessage.streamId}`,
    key: `${threadId}-${streamMessage.order}-${streamMessage.stepOrder}`,
    order: streamMessage.order,
    stepOrder: streamMessage.stepOrder,
    status: statusFromStreamStatus(streamMessage.status),
    agentName: streamMessage.agentName,
    text: "",
    _creationTime: Date.now(),
    role: "assistant",
    parts: [],
    ...(streamMessage.metadata ? { metadata: streamMessage.metadata } : {}),
  };
}

export function statusFromStreamStatus(
  status: StreamMessage["status"],
): MessageStatus | "streaming" {
  switch (status) {
    case "streaming":
      return "streaming";
    case "finished":
      return "success";
    case "aborted":
      return "failed";
    default:
      return "pending";
  }
}

export async function updateFromUIMessageChunks(
  uiMessage: UIMessage,
  parts: UIMessageChunk[],
) {
  if (parts.length === 0) {
    return uiMessage;
  }
  const partsStream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
  let failed = false;
  let suppressError = false;
  const messageStream = readUIMessageStream({
    message: uiMessage,
    stream: partsStream,
    onError: (e) => {
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (errorMessage.toLowerCase().includes("no tool invocation found")) {
        suppressError = true;
        return;
      }
      failed = true;
      console.error("Error in stream", e);
    },
    terminateOnError: true,
  });
  let message = uiMessage;
  try {
    for await (const messagePart of messageStream) {
      assert(
        messagePart.id === message.id,
        `Expecting to only make one UIMessage in a stream`,
      );
      message = messagePart;
    }
  } catch (e) {
    if (!suppressError) {
      throw e;
    }
  }
  if (failed) {
    message.status = "failed";
  }
  message.text = joinText(message.parts);
  return message;
}

type ToolPart = ToolUIPart | DynamicToolUIPart;

function transitionToolPart<S extends ToolPart["state"]>(
  part: ToolPart,
  updates: { state: S } & Partial<Extract<ToolPart, { state: S }>>,
): void {
  Object.assign(part, updates);
}

export type IncrementalStreamState = {
  // chunk id -> index of the streaming text part in message.parts
  activeText: Record<string, number>;
  // chunk id -> index of the streaming reasoning part in message.parts
  activeReasoning: Record<string, number>;
  // toolCallId -> raw accumulated input JSON text (kept separate from the
  // parsed `input` so partial JSON can be repair-parsed each batch)
  toolInputText: Record<string, string>;
};

export function emptyIncrementalStreamState(): IncrementalStreamState {
  return { activeText: {}, activeReasoning: {}, toolInputText: {} };
}

/**
 * Apply a batch of new UIMessageChunks to an existing UIMessage without
 * replaying prior chunks. `prev` carries the ephemeral stream state that the
 * UIMessage itself can't hold (which text/reasoning parts are still streaming,
 * and the raw accumulated tool input text). Parts are append-only, so part
 * indices stay stable across the structuredClone between batches. Behavior
 * mirrors the AI SDK's processUIMessageStream.
 */
export function applyUIMessageChunksIncremental(
  uiMessage: UIMessage,
  newParts: UIMessageChunk[],
  prev: IncrementalStreamState,
): { message: UIMessage; streamState: IncrementalStreamState } {
  const message: UIMessage = structuredClone(uiMessage);
  const activeText: Record<string, number> = { ...prev.activeText };
  const activeReasoning: Record<string, number> = { ...prev.activeReasoning };
  const toolInputText: Record<string, string> = { ...prev.toolInputText };
  const touchedTools = new Set<string>();

  const toolIndexById = new Map<string, number>();
  message.parts.forEach((p, i) => {
    if (
      "toolCallId" in p &&
      (p.type.startsWith("tool-") || p.type === "dynamic-tool")
    ) {
      toolIndexById.set((p as ToolPart).toolCallId, i);
    }
  });
  const toolPartAt = (toolCallId: string): ToolPart | undefined => {
    const idx = toolIndexById.get(toolCallId);
    return idx === undefined ? undefined : (message.parts[idx] as ToolPart);
  };
  const mergeMetadata = (metadata: unknown) => {
    if (metadata == null) {
      return;
    }
    message.metadata = {
      ...(message.metadata as Record<string, unknown> | undefined),
      ...(metadata as Record<string, unknown>),
    } as typeof message.metadata;
  };

  for (const part of newParts) {
    switch (part.type) {
      case "text-start": {
        const newPart: TextUIPart = {
          type: "text",
          text: "",
          state: "streaming",
          providerMetadata: part.providerMetadata,
        };
        message.parts.push(newPart);
        activeText[part.id] = message.parts.length - 1;
        break;
      }
      case "text-delta": {
        const idx = activeText[part.id];
        if (idx !== undefined) {
          const textPart = message.parts[idx] as TextUIPart;
          textPart.text += part.delta;
          textPart.providerMetadata = mergeProviderMetadata(
            textPart.providerMetadata,
            part.providerMetadata,
          );
        }
        break;
      }
      case "text-end": {
        const idx = activeText[part.id];
        if (idx !== undefined) {
          const textPart = message.parts[idx] as TextUIPart;
          textPart.state = "done";
          textPart.providerMetadata = mergeProviderMetadata(
            textPart.providerMetadata,
            part.providerMetadata,
          );
          delete activeText[part.id];
        }
        break;
      }
      case "reasoning-start": {
        const newPart: ReasoningUIPart = {
          type: "reasoning",
          text: "",
          state: "streaming",
          providerMetadata: part.providerMetadata,
        };
        message.parts.push(newPart);
        activeReasoning[part.id] = message.parts.length - 1;
        break;
      }
      case "reasoning-delta": {
        const idx = activeReasoning[part.id];
        if (idx !== undefined) {
          const reasoningPart = message.parts[idx] as ReasoningUIPart;
          reasoningPart.text += part.delta;
          reasoningPart.providerMetadata = mergeProviderMetadata(
            reasoningPart.providerMetadata,
            part.providerMetadata,
          );
        }
        break;
      }
      case "reasoning-end": {
        const idx = activeReasoning[part.id];
        if (idx !== undefined) {
          const reasoningPart = message.parts[idx] as ReasoningUIPart;
          reasoningPart.state = "done";
          reasoningPart.providerMetadata = mergeProviderMetadata(
            reasoningPart.providerMetadata,
            part.providerMetadata,
          );
          delete activeReasoning[part.id];
        }
        break;
      }
      case "tool-input-start": {
        const newToolPart: ToolUIPart | DynamicToolUIPart = part.dynamic
          ? ({
              type: "dynamic-tool",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              state: "input-streaming",
              input: undefined,
            } satisfies DynamicToolUIPart)
          : ({
              type: `tool-${part.toolName}`,
              toolCallId: part.toolCallId,
              state: "input-streaming",
              input: undefined,
              providerExecuted: part.providerExecuted,
            } satisfies ToolUIPart);
        message.parts.push(newToolPart);
        toolIndexById.set(part.toolCallId, message.parts.length - 1);
        toolInputText[part.toolCallId] = "";
        break;
      }
      case "tool-input-delta": {
        if (toolIndexById.has(part.toolCallId)) {
          toolInputText[part.toolCallId] =
            (toolInputText[part.toolCallId] ?? "") + part.inputTextDelta;
          touchedTools.add(part.toolCallId);
        } else {
          console.warn(
            `tool-input-delta for unknown toolCallId ${part.toolCallId}`,
          );
        }
        break;
      }
      case "tool-input-available": {
        const toolPart = toolPartAt(part.toolCallId);
        if (toolPart) {
          transitionToolPart(toolPart, {
            state: "input-available",
            input: part.input,
            callProviderMetadata: mergeProviderMetadata(
              (toolPart as { callProviderMetadata?: ProviderMetadata })
                .callProviderMetadata,
              part.providerMetadata,
            ),
          });
        }
        touchedTools.delete(part.toolCallId);
        // The raw JSON buffer is no longer needed; drop it so it doesn't get
        // carried through every later batch on the hot path.
        delete toolInputText[part.toolCallId];
        break;
      }
      case "tool-input-error": {
        const toolPart = toolPartAt(part.toolCallId);
        if (toolPart) {
          transitionToolPart(toolPart, {
            state: "output-error",
            errorText: part.errorText,
            providerExecuted: part.providerExecuted,
            ...(toolPart.type === "dynamic-tool"
              ? { input: part.input }
              : { input: undefined, rawInput: part.input }),
            callProviderMetadata: mergeProviderMetadata(
              (toolPart as { callProviderMetadata?: ProviderMetadata })
                .callProviderMetadata,
              part.providerMetadata,
            ),
          });
        }
        touchedTools.delete(part.toolCallId);
        delete toolInputText[part.toolCallId];
        break;
      }
      case "tool-output-available": {
        const toolPart = toolPartAt(part.toolCallId);
        if (toolPart) {
          transitionToolPart(toolPart, {
            state: "output-available",
            output: part.output,
            preliminary: part.preliminary,
            providerExecuted: part.providerExecuted,
          });
        }
        break;
      }
      case "tool-output-error": {
        const toolPart = toolPartAt(part.toolCallId);
        if (toolPart) {
          transitionToolPart(toolPart, {
            state: "output-error",
            errorText: part.errorText,
            providerExecuted: part.providerExecuted,
          });
        }
        break;
      }
      case "tool-output-denied": {
        const toolPart = toolPartAt(part.toolCallId);
        if (toolPart) {
          transitionToolPart(toolPart, { state: "output-denied" });
        }
        break;
      }
      case "tool-approval-request": {
        const toolPart = toolPartAt(part.toolCallId);
        if (toolPart) {
          transitionToolPart(toolPart, {
            state: "approval-requested",
            approval: { id: part.approvalId },
          });
        }
        break;
      }
      case "source-url":
        message.parts.push({
          type: "source-url",
          url: part.url,
          sourceId: part.sourceId,
          title: part.title,
          providerMetadata: part.providerMetadata,
        });
        break;
      case "source-document":
        message.parts.push({
          type: "source-document",
          mediaType: part.mediaType,
          sourceId: part.sourceId,
          title: part.title,
          filename: part.filename,
          providerMetadata: part.providerMetadata,
        });
        break;
      case "file":
        message.parts.push({
          type: "file",
          mediaType: part.mediaType,
          url: part.url,
        });
        break;
      case "start-step":
        message.parts.push({ type: "step-start" });
        break;
      case "finish-step":
        // Match the SDK: a new step starts fresh streaming parts; the prior
        // parts keep their state rather than being forced to "done".
        for (const id of Object.keys(activeText)) delete activeText[id];
        for (const id of Object.keys(activeReasoning))
          delete activeReasoning[id];
        break;
      case "start":
      case "finish":
      case "message-metadata":
        mergeMetadata(part.messageMetadata);
        break;
      case "abort":
      case "error":
        // The stream-level status (statusFromStreamStatus) is authoritative and
        // is applied by the caller; nothing to mutate on the message here.
        break;
      default: {
        if (typeof part.type === "string" && part.type.startsWith("data-")) {
          const dataPart = part as Extract<
            UIMessageChunk,
            { type: `data-${string}` }
          >;
          const existingIdx =
            dataPart.id != null
              ? message.parts.findIndex(
                  (p) =>
                    p.type === dataPart.type &&
                    (p as { id?: string }).id === dataPart.id,
                )
              : -1;
          if (existingIdx >= 0) {
            (message.parts[existingIdx] as { data?: unknown }).data =
              dataPart.data;
          } else {
            message.parts.push(
              dataPart as unknown as UIMessage["parts"][number],
            );
          }
        } else {
          console.warn(
            `applyUIMessageChunksIncremental: unhandled chunk type ${String(part.type)}`,
          );
        }
        break;
      }
    }
  }

  for (const toolCallId of touchedTools) {
    const toolPart = toolPartAt(toolCallId);
    if (toolPart && toolPart.state === "input-streaming") {
      try {
        toolPart.input = JSON.parse(toolInputText[toolCallId] ?? "");
      } catch {
        // partial JSON — leave input unset until complete
      }
    }
  }

  message.text = joinText(message.parts);
  return {
    message,
    streamState: { activeText, activeReasoning, toolInputText },
  };
}

export async function deriveUIMessagesFromDeltas(
  threadId: string,
  streamMessages: StreamMessage[],
  allDeltas: StreamDelta[],
): Promise<UIMessage[]> {
  const messages: UIMessage[] = [];
  for (const streamMessage of streamMessages) {
    if (streamMessage.format !== "UIMessageChunk") {
      throw new Error(
        `deriveUIMessagesFromDeltas: unsupported stream format "${streamMessage.format ?? "text"}" for stream ${streamMessage.streamId}`,
      );
    }
    const { parts } = getParts<UIMessageChunk>(
      allDeltas.filter((d) => d.streamId === streamMessage.streamId),
      0,
    );
    const uiMessage = await updateFromUIMessageChunks(
      blankUIMessage(streamMessage, threadId),
      parts,
    );
    messages.push(uiMessage);
  }
  return sorted(messages);
}

export function getParts<T extends StreamDelta["parts"][number]>(
  deltas: StreamDelta[],
  fromCursor?: number,
): { parts: T[]; cursor: number } {
  const parts: T[] = [];
  let cursor = fromCursor ?? 0;
  for (const delta of deltas.sort((a, b) => a.start - b.start)) {
    if (delta.parts.length === 0) {
      console.debug(`Got delta with no parts: ${JSON.stringify(delta)}`);
      continue;
    }
    if (cursor !== delta.start) {
      if (cursor >= delta.end) {
        continue;
      } else if (cursor < delta.start) {
        console.warn(
          `Got delta for stream ${delta.streamId} that has a gap ${cursor} -> ${delta.start}`,
        );
        break;
      } else {
        throw new Error(
          `Got unexpected delta for stream ${delta.streamId}: delta: ${delta.start} -> ${delta.end} existing cursor: ${cursor}`,
        );
      }
    }
    parts.push(...delta.parts);
    cursor = delta.end;
  }
  return { parts, cursor };
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
