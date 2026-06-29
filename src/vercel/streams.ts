import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type FinishReason,
  type UIMessageChunk,
} from "ai";
import type { AgentRunEvent } from "../validators.js";
import type { AgentRunEventItem } from "../client/runEvents.js";
import type {
  AgentStreamWriter,
  AgentVercelMessageMetadata,
  AgentVercelStreamOptions,
  AgentVercelStreamResponseOptions,
  AgentVercelUIMessage,
} from "./types.js";

/**
 * Convert ordered Agent run events into an AI SDK 7 `UIMessageChunk` stream.
 *
 * @internal
 */
export function toVercelUIMessageStream(
  events: Iterable<AgentRunEventItem> | AsyncIterable<AgentRunEventItem>,
  options: AgentVercelStreamOptions = {},
): ReadableStream<UIMessageChunk> {
  return createUIMessageStream<AgentVercelUIMessage>({
    onError: options.onError,
    execute: async ({ writer }) => {
      await writeAgentRunEvents(writer, events, options);
    },
  });
}

/**
 * Convert ordered Agent run events into a Vercel AI SDK SSE `Response`.
 *
 * @internal
 */
export function toVercelUIMessageStreamResponse(
  events: Iterable<AgentRunEventItem> | AsyncIterable<AgentRunEventItem>,
  options: AgentVercelStreamResponseOptions = {},
): Response {
  const { status, statusText, headers, ...streamOptions } = options;
  return createUIMessageStreamResponse({
    status,
    statusText,
    headers,
    stream: toVercelUIMessageStream(events, streamOptions),
  });
}

/**
 * Write Agent run events to an AI SDK stream writer.
 *
 * @remarks
 * Adapter authors can use this when they need to merge Agent events into a
 * larger AI SDK stream with framework-specific chunks.
 *
 * @internal
 */
export async function writeAgentRunEvents(
  writer: AgentStreamWriter,
  events: Iterable<AgentRunEventItem> | AsyncIterable<AgentRunEventItem>,
  options: AgentVercelStreamOptions = {},
): Promise<void> {
  const state = {
    textOpen: false,
    reasoningOpen: false,
    textId: "",
    reasoningId: "",
    textCount: 0,
    reasoningCount: 0,
    finishReason: "stop" as FinishReason,
    messageMetadata: options.messageMetadata,
  };
  writer.write({
    type: "start",
    messageId: options.messageId,
    messageMetadata: state.messageMetadata,
  });
  for await (const item of events) {
    writeAgentRunEvent(writer, item.event, state);
  }
  closeOpenParts(writer, state);
  writer.write({
    type: "finish",
    finishReason: state.finishReason,
    messageMetadata: state.messageMetadata,
  });
}

function writeAgentRunEvent(
  writer: AgentStreamWriter,
  event: AgentRunEvent,
  state: VercelRunStreamState,
) {
  if (event.type === "text.delta") {
    if (state.reasoningOpen) {
      writer.write({ type: "reasoning-end", id: state.reasoningId });
      state.reasoningOpen = false;
    }
    if (!state.textOpen) {
      state.textId = `text-${state.textCount++}`;
      writer.write({ type: "text-start", id: state.textId });
      state.textOpen = true;
    }
    writer.write({ type: "text-delta", id: state.textId, delta: event.text });
  } else if (event.type === "reasoning.delta") {
    if (state.textOpen) {
      writer.write({ type: "text-end", id: state.textId });
      state.textOpen = false;
    }
    if (!state.reasoningOpen) {
      state.reasoningId = `reasoning-${state.reasoningCount++}`;
      writer.write({ type: "reasoning-start", id: state.reasoningId });
      state.reasoningOpen = true;
    }
    writer.write({
      type: "reasoning-delta",
      id: state.reasoningId,
      delta: event.text,
    });
  } else {
    closeOpenParts(writer, state);
    writeDiscreteEvent(writer, event, state);
  }
}

type VercelRunStreamState = {
  textOpen: boolean;
  reasoningOpen: boolean;
  textId: string;
  reasoningId: string;
  textCount: number;
  reasoningCount: number;
  finishReason: FinishReason;
  messageMetadata: AgentVercelMessageMetadata | undefined;
};

function writeDiscreteEvent(
  writer: AgentStreamWriter,
  event: AgentRunEvent,
  state: VercelRunStreamState,
) {
  if (event.type === "source") {
    if (event.source.sourceType === "url" && event.source.url) {
      writer.write({
        type: "source-url",
        sourceId: event.source.id,
        url: event.source.url,
        title: event.source.title,
      });
    } else {
      writer.write({
        type: "source-document",
        sourceId: event.source.id,
        mediaType: event.source.mediaType ?? "text/plain",
        title: event.source.title ?? event.source.filename ?? event.source.id,
        filename: event.source.filename,
      });
    }
  } else if (event.type === "file") {
    if (event.file.url) {
      writer.write({
        type: "file",
        url: event.file.url,
        mediaType: event.file.mediaType,
      });
    }
  } else if (event.type === "tool.call") {
    writer.write({
      type: "tool-input-available",
      toolCallId: event.toolCallId,
      toolName: event.name,
      input: event.input,
      dynamic: true,
    });
  } else if (event.type === "tool.result") {
    if (event.error) {
      writer.write({
        type: "tool-output-error",
        toolCallId: event.toolCallId,
        errorText: event.error.message,
        dynamic: true,
      });
    } else {
      writer.write({
        type: "tool-output-available",
        toolCallId: event.toolCallId,
        output: event.output,
        dynamic: true,
      });
    }
  } else if (event.type === "approval.request") {
    writer.write({
      type: "tool-input-available",
      toolCallId: event.toolCallId,
      toolName: event.name,
      input: event.input,
      dynamic: true,
    });
    writer.write({
      type: "tool-approval-request",
      approvalId: event.approvalId,
      toolCallId: event.toolCallId,
    });
  } else if (event.type === "approval.response") {
    writer.write({
      type: "tool-approval-response",
      approvalId: event.approvalId,
      approved: event.approved,
      reason: event.reason,
    });
    if (!event.approved) {
      writer.write({ type: "tool-output-denied", toolCallId: event.toolCallId });
    }
  } else if (event.type === "data") {
    writer.write({
      type: "data-agent-data",
      id: event.name,
      data: { name: event.name, value: event.value },
    });
  } else if (event.type === "output") {
    writer.write({ type: "data-agent-output", data: event.value });
  } else if (event.type === "message") {
    writer.write({
      type: "data-agent-message",
      id: event.message.clientKey,
      data: event.message,
    });
  } else if (event.type === "usage") {
    mergeAgentMetadata(writer, state, { usage: event.usage });
  } else if (event.type === "error") {
    state.finishReason = "error";
    mergeAgentMetadata(writer, state, { error: event.error.message });
    writer.write({ type: "error", errorText: event.error.message });
  } else if (event.type === "done" && event.usage) {
    mergeAgentMetadata(writer, state, { usage: event.usage });
  }
}

function closeOpenParts(writer: AgentStreamWriter, state: VercelRunStreamState) {
  if (state.textOpen) {
    writer.write({ type: "text-end", id: state.textId });
    state.textOpen = false;
  }
  if (state.reasoningOpen) {
    writer.write({ type: "reasoning-end", id: state.reasoningId });
    state.reasoningOpen = false;
  }
}

function mergeAgentMetadata(
  writer: AgentStreamWriter,
  state: VercelRunStreamState,
  patch: NonNullable<AgentVercelMessageMetadata["agent"]>,
) {
  state.messageMetadata = {
    ...state.messageMetadata,
    agent: {
      ...state.messageMetadata?.agent,
      ...patch,
    },
  };
  writer.write({
    type: "message-metadata",
    messageMetadata: state.messageMetadata,
  });
}
