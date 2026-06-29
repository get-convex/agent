import type {
  UIDataTypes,
  UIMessage,
  UIMessageStreamWriter,
  UITools,
} from "ai";
import type { Value } from "convex/values";
import type {
  AgentError,
  AgentMessageInput,
  AgentMessagePart,
  AgentUsage,
} from "../validators.js";

/**
 * Agent metadata attached to Vercel UI messages produced by this adapter.
 *
 * @internal
 */
export type AgentVercelMessageMetadata = {
  agent?: {
    messageId?: string;
    threadId?: string;
    runId?: string;
    _creationTime?: number;
    usage?: AgentUsage;
    error?: string;
  };
};

/**
 * Data parts used when an Agent event has no direct AI SDK UI part.
 *
 * @internal
 */
export type AgentVercelData = {
  "agent-data": {
    name: string;
    value: Value;
  };
  "agent-output": Value;
  "agent-error": AgentError;
  "agent-file": Extract<AgentMessagePart, { type: "file" }>;
  "agent-approval-request": Extract<
    AgentMessagePart,
    { type: "approval-request" }
  >;
  "agent-approval-response": Extract<
    AgentMessagePart,
    { type: "approval-response" }
  >;
  "agent-message": AgentMessageInput;
};

/**
 * Default Vercel UI message shape used by the Agent adapter.
 *
 * @internal
 */
export type AgentVercelUIMessage<
  Data extends UIDataTypes = AgentVercelData,
  Tools extends UITools = UITools,
> = UIMessage<AgentVercelMessageMetadata, Data, Tools>;

/**
 * Options for converting Agent messages into Vercel UI messages.
 *
 * @internal
 */
export type ToVercelMessageOptions = {
  /** Optional run id to include in message metadata. */
  runId?: string;
};

/**
 * Options for converting Vercel UI messages into Agent messages.
 *
 * @internal
 */
export type FromVercelMessageOptions = {
  /** Agent name used when converting assistant-authored messages. */
  agentName?: string;
  /** User id used when converting user-authored messages. */
  userId?: string;
};

/**
 * Options for producing AI SDK UI message chunks from Agent run events.
 *
 * @internal
 */
export type AgentVercelStreamOptions = {
  /** Message id to put in the AI SDK `start` chunk. */
  messageId?: string;
  /** Metadata to attach to the AI SDK `start` and `finish` chunks. */
  messageMetadata?: AgentVercelMessageMetadata;
  /** Convert thrown errors into a user-facing stream error string. */
  onError?: (error: unknown) => string;
};

/**
 * Options for producing a Vercel-compatible SSE `Response`.
 *
 * @internal
 */
export type AgentVercelStreamResponseOptions = AgentVercelStreamOptions & {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
};

/** @internal */
export type AgentStreamWriter = UIMessageStreamWriter<AgentVercelUIMessage>;
