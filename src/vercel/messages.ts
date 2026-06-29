import {
  isStaticToolUIPart,
  type UIDataTypes,
  type UIMessage,
  type UIMessagePart,
  type UITools,
} from "ai";
import type {
  AgentMessageDoc,
  AgentMessageInput,
  AgentMessagePart,
} from "../validators.js";
import type {
  AgentVercelData,
  AgentVercelUIMessage,
  FromVercelMessageOptions,
  ToVercelMessageOptions,
} from "./types.js";

type AgentMessageLike = AgentMessageDoc | AgentMessageInput;

/**
 * Convert a persisted Agent message to an AI SDK 7 `UIMessage`.
 *
 * @remarks
 * Tool calls and Agent-only data remain representable through AI SDK dynamic
 * tool parts and data parts, while the Agent message stays the source of truth.
 *
 * @internal
 */
export function toVercelMessage(
  message: AgentMessageLike,
  options: ToVercelMessageOptions = {},
): AgentVercelUIMessage {
  const agentMessage = normalizeAgentMessage(message);
  const docFields =
    "_id" in message
      ? {
          id: message._id,
          threadId: message.threadId,
        }
      : {
          id: message.clientKey ?? `agent-message:${stableMessageText(message)}`,
          threadId: undefined,
        };
  return {
    id: docFields.id,
    role: toVercelRole(agentMessage.author.type),
    metadata: {
      agent: {
        messageId: "_id" in message ? message._id : undefined,
        threadId: docFields.threadId,
        runId: options.runId,
        _creationTime:
          "_creationTime" in message ? message._creationTime : undefined,
        usage: message.usage,
        error: message.error,
      },
    },
    parts: agentMessage.content.flatMap(toVercelPart),
  };
}

/**
 * Convert multiple persisted Agent messages into AI SDK 7 `UIMessage`s.
 *
 * @internal
 */
export function toVercelMessages(
  messages: readonly (AgentMessageDoc | AgentMessageInput)[],
  options: ToVercelMessageOptions = {},
): AgentVercelUIMessage[] {
  return messages.map((message) => toVercelMessage(message, options));
}

/**
 * Convert an AI SDK 7 `UIMessage` into an Agent-native message input.
 *
 * @remarks
 * This is useful for Vercel chat clients that post UI messages to a Convex
 * mutation. Provider-specific metadata is intentionally not persisted in core
 * Agent messages.
 *
 * @internal
 */
export function fromVercelMessage(
  message: UIMessage,
  options: FromVercelMessageOptions = {},
): AgentMessageInput {
  return {
    clientKey: message.id,
    message: {
      author: fromVercelRole(message.role, options),
      content: message.parts.flatMap(fromVercelPart),
    },
  };
}

/**
 * Convert multiple AI SDK 7 `UIMessage`s into Agent-native message inputs.
 *
 * @internal
 */
export function fromVercelMessages(
  messages: readonly UIMessage[],
  options: FromVercelMessageOptions = {},
): AgentMessageInput[] {
  return messages.map((message) => fromVercelMessage(message, options));
}

function toVercelRole(
  author: AgentMessageInput["message"]["author"]["type"],
): AgentVercelUIMessage["role"] {
  if (author === "system") {
    return "system";
  }
  if (author === "user") {
    return "user";
  }
  return "assistant";
}

function normalizeAgentMessage(message: AgentMessageLike) {
  if (message.message !== undefined) {
    return message.message;
  }
  return {
    author: {
      type: "agent",
      name: "_id" in message ? message.agentName ?? "Assistant" : "Assistant",
    } as const,
    content:
      message.text === undefined
        ? []
        : [{ type: "text", text: message.text } satisfies AgentMessagePart],
  };
}

function fromVercelRole(
  role: UIMessage["role"],
  options: FromVercelMessageOptions,
): AgentMessageInput["message"]["author"] {
  if (role === "system") {
    return { type: "system" };
  }
  if (role === "user") {
    return options.userId === undefined
      ? { type: "user" }
      : { type: "user", userId: options.userId };
  }
  return { type: "agent", name: options.agentName ?? "Assistant" };
}

function toVercelPart(
  part: AgentMessagePart,
): UIMessagePart<AgentVercelData, UITools>[] {
  if (part.type === "text") {
    return [{ type: "text", text: part.text, state: "done" }];
  }
  if (part.type === "reasoning") {
    return [{ type: "reasoning", text: part.text, state: "done" }];
  }
  if (part.type === "file") {
    if (!part.url) {
      return [{ type: "data-agent-file", id: part.fileId, data: part }];
    }
    return [
      {
        type: "file",
        url: part.url,
        mediaType: part.mediaType,
        filename: part.filename,
      },
    ];
  }
  if (part.type === "source") {
    if (part.sourceType === "url" && part.url) {
      return [
        {
          type: "source-url",
          sourceId: part.id,
          url: part.url,
          title: part.title,
        },
      ];
    }
    return [
      {
        type: "source-document",
        sourceId: part.id,
        mediaType: part.mediaType ?? "text/plain",
        title: part.title ?? part.filename ?? part.id,
        filename: part.filename,
      },
    ];
  }
  if (part.type === "tool-call") {
    return [
      {
        type: "dynamic-tool",
        toolName: part.name,
        toolCallId: part.toolCallId,
        state: "input-available",
        input: part.input,
      },
    ];
  }
  if (part.type === "tool-result") {
    return [
      part.error
        ? {
            type: "dynamic-tool",
            toolName: part.name ?? "tool",
            toolCallId: part.toolCallId,
            state: "output-error",
            input: undefined,
            errorText: part.error.message,
          }
        : {
            type: "dynamic-tool",
            toolName: part.name ?? "tool",
            toolCallId: part.toolCallId,
            state: "output-available",
            input: undefined,
            output: part.output,
          },
    ];
  }
  if (part.type === "approval-request") {
    return [
      { type: "data-agent-approval-request", id: part.approvalId, data: part },
    ];
  }
  if (part.type === "approval-response") {
    return [
      { type: "data-agent-approval-response", id: part.approvalId, data: part },
    ];
  }
  return [];
}

function fromVercelPart(
  part: UIMessagePart<UIDataTypes, UITools>,
): AgentMessagePart[] {
  if (part.type === "text") {
    return [{ type: "text", text: part.text }];
  }
  if (part.type === "reasoning") {
    return [{ type: "reasoning", text: part.text }];
  }
  if (part.type === "file") {
    return [
      {
        type: "file",
        url: part.url,
        mediaType: part.mediaType,
        filename: part.filename,
      },
    ];
  }
  if (part.type === "data-agent-file" && isAgentFilePart(part.data)) {
    return [part.data];
  }
  if (
    part.type === "data-agent-approval-request" &&
    isApprovalRequestPart(part.data)
  ) {
    return [part.data];
  }
  if (
    part.type === "data-agent-approval-response" &&
    isApprovalResponsePart(part.data)
  ) {
    return [part.data];
  }
  if (part.type === "source-url") {
    return [
      {
        type: "source",
        sourceType: "url",
        id: part.sourceId,
        url: part.url,
        title: part.title,
      },
    ];
  }
  if (part.type === "source-document") {
    return [
      {
        type: "source",
        sourceType: "document",
        id: part.sourceId,
        title: part.title,
        mediaType: part.mediaType,
        filename: part.filename,
      },
    ];
  }
  if (part.type === "dynamic-tool") {
    if (
      part.state === "input-available" ||
      part.state === "approval-requested"
    ) {
      return [
        {
          type: "tool-call",
          toolCallId: part.toolCallId,
          name: part.toolName,
          input: part.input,
        },
      ];
    }
    if (part.state === "output-available") {
      return [
        {
          type: "tool-result",
          toolCallId: part.toolCallId,
          name: part.toolName,
          output: part.output,
        },
      ];
    }
    if (part.state === "output-error") {
      return [
        {
          type: "tool-result",
          toolCallId: part.toolCallId,
          name: part.toolName,
          error: { code: "tool-error", message: part.errorText },
        },
      ];
    }
  }
  if (isStaticToolUIPart(part)) {
    const name = part.type.slice("tool-".length);
    if (
      part.state === "input-available" ||
      part.state === "approval-requested"
    ) {
      return [
        {
          type: "tool-call",
          toolCallId: part.toolCallId,
          name,
          input: part.input,
        },
      ];
    }
    if (part.state === "output-available") {
      return [
        {
          type: "tool-result",
          toolCallId: part.toolCallId,
          name,
          output: part.output,
        },
      ];
    }
    if (part.state === "output-error") {
      return [
        {
          type: "tool-result",
          toolCallId: part.toolCallId,
          name,
          error: { code: "tool-error", message: part.errorText },
        },
      ];
    }
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentFilePart(
  value: unknown,
): value is Extract<AgentMessagePart, { type: "file" }> {
  return (
    isRecord(value) &&
    value.type === "file" &&
    typeof value.mediaType === "string"
  );
}

function isApprovalRequestPart(
  value: unknown,
): value is Extract<AgentMessagePart, { type: "approval-request" }> {
  return (
    isRecord(value) &&
    value.type === "approval-request" &&
    typeof value.approvalId === "string" &&
    typeof value.toolCallId === "string"
  );
}

function isApprovalResponsePart(
  value: unknown,
): value is Extract<AgentMessagePart, { type: "approval-response" }> {
  return (
    isRecord(value) &&
    value.type === "approval-response" &&
    typeof value.approvalId === "string" &&
    typeof value.toolCallId === "string" &&
    typeof value.approved === "boolean"
  );
}

function stableMessageText(message: AgentMessageInput) {
  return message.message.content
    .map((part) => (part.type === "text" ? part.text : part.type))
    .join(":");
}
