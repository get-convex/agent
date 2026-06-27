import type { Infer } from "convex/values";
import { v } from "convex/values";

export const vThreadStatus = v.union(
  v.literal("active"),
  v.literal("archived"),
);

export const vMessageStatus = v.union(
  v.literal("pending"),
  v.literal("success"),
  v.literal("failed"),
);
export type MessageStatus = Infer<typeof vMessageStatus>;

export const vAgentStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("waiting"),
  v.literal("success"),
  v.literal("failed"),
  v.literal("canceled"),
);
export type AgentStatus = Infer<typeof vAgentStatus>;

/** Tool-call lifecycle state for Agent-native tool projections. @public */
export const vAgentToolStatus = v.union(
  v.literal("pending"),
  v.literal("waiting"),
  v.literal("success"),
  v.literal("failed"),
  v.literal("canceled"),
);
export type AgentToolStatus = Infer<typeof vAgentToolStatus>;

/** @public */
export const vAgentError = v.object({
  code: v.string(),
  message: v.string(),
});
export type AgentError = Infer<typeof vAgentError>;

/** @public */
export const vAgentWaiting = v.object({
  reason: v.literal("approval"),
  toolCallIds: v.array(v.string()),
});
export type AgentWaiting = Infer<typeof vAgentWaiting>;

/** @public */
export const vAgentUsage = v.object({
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  tokenDetails: v.optional(
    v.object({
      input: v.optional(v.record(v.string(), v.number())),
      output: v.optional(v.record(v.string(), v.number())),
    }),
  ),
});
export type AgentUsage = Infer<typeof vAgentUsage>;

/** Agent-native author for a persisted thread message. @public */
export const vAgentMessageAuthor = v.union(
  v.object({
    type: v.literal("user"),
    userId: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("agent"),
    name: v.string(),
  }),
  v.object({
    type: v.literal("tool"),
    name: v.string(),
    toolCallId: v.string(),
  }),
  v.object({
    type: v.literal("system"),
  }),
);
export type AgentMessageAuthor = Infer<typeof vAgentMessageAuthor>;

const vAgentSource = v.union(
  v.object({
    sourceType: v.literal("url"),
    id: v.string(),
    title: v.optional(v.string()),
    url: v.string(),
    mediaType: v.optional(v.string()),
    filename: v.optional(v.string()),
  }),
  v.object({
    sourceType: v.literal("document"),
    id: v.string(),
    title: v.optional(v.string()),
    url: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    filename: v.optional(v.string()),
  }),
);

const vAgentFilePartFields = {
  fileId: v.optional(v.string()),
  url: v.optional(v.string()),
  data: v.optional(v.union(v.string(), v.bytes())),
  mediaType: v.string(),
  filename: v.optional(v.string()),
};

/** Agent-owned content part for persisted messages. @public */
export const vAgentMessagePart = v.union(
  v.object({
    type: v.literal("text"),
    text: v.string(),
  }),
  v.object({
    type: v.literal("reasoning"),
    text: v.string(),
  }),
  v.object({
    type: v.literal("file"),
    ...vAgentFilePartFields,
  }),
  v.object({
    type: v.literal("source"),
    ...vAgentSource.members[0].fields,
  }),
  v.object({
    type: v.literal("source"),
    ...vAgentSource.members[1].fields,
  }),
  v.object({
    type: v.literal("tool-call"),
    toolCallId: v.string(),
    name: v.string(),
    input: v.any(),
  }),
  v.object({
    type: v.literal("tool-result"),
    toolCallId: v.string(),
    name: v.optional(v.string()),
    output: v.optional(v.any()),
    error: v.optional(vAgentError),
  }),
  v.object({
    type: v.literal("approval-request"),
    approvalId: v.string(),
    toolCallId: v.string(),
  }),
  v.object({
    type: v.literal("approval-response"),
    approvalId: v.string(),
    toolCallId: v.string(),
    approved: v.boolean(),
    reason: v.optional(v.string()),
  }),
);
export type AgentMessagePart = Infer<typeof vAgentMessagePart>;

/** @public */
export const vAgentMessageContent = v.array(vAgentMessagePart);
export type AgentMessageContent = Infer<typeof vAgentMessageContent>;

/** Agent-native message node stored in a thread projection. @public */
export const vAgentMessage = v.object({
  author: vAgentMessageAuthor,
  content: vAgentMessageContent,
});
export type AgentMessage = Infer<typeof vAgentMessage>;

/** Public message input shape accepted by Agent message APIs. @public */
export const vAgentMessageInput = v.object({
  message: vAgentMessage,
  clientKey: v.optional(v.string()),
  text: v.optional(v.string()),
  status: v.optional(vMessageStatus),
  usage: v.optional(vAgentUsage),
  error: v.optional(v.string()),
});
export type AgentMessageInput = Infer<typeof vAgentMessageInput>;

/** Component-internal message input shape. @internal */
export const vAgentMessageInputInternal = vAgentMessageInput;
export type AgentMessageInputInternal = Infer<
  typeof vAgentMessageInputInternal
>;

/** Event payload stored in a run-owned Stream. @public */
export const vAgentRunEvent = v.union(
  v.object({
    type: v.literal("text.delta"),
    text: v.string(),
  }),
  v.object({
    type: v.literal("reasoning.delta"),
    text: v.string(),
    signature: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("source"),
    source: vAgentSource,
  }),
  v.object({
    type: v.literal("file"),
    file: v.object(vAgentFilePartFields),
  }),
  v.object({
    type: v.literal("tool.call"),
    toolCallId: v.string(),
    name: v.string(),
    input: v.any(),
  }),
  v.object({
    type: v.literal("tool.result"),
    toolCallId: v.string(),
    name: v.optional(v.string()),
    output: v.optional(v.any()),
    error: v.optional(vAgentError),
  }),
  v.object({
    type: v.literal("approval.request"),
    approvalId: v.string(),
    toolCallId: v.string(),
    name: v.string(),
    input: v.any(),
  }),
  v.object({
    type: v.literal("approval.response"),
    approvalId: v.string(),
    toolCallId: v.string(),
    approved: v.boolean(),
    reason: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("data"),
    name: v.string(),
    value: v.any(),
  }),
  v.object({
    type: v.literal("output"),
    value: v.any(),
  }),
  v.object({
    type: v.literal("usage"),
    usage: vAgentUsage,
  }),
  v.object({
    type: v.literal("message"),
    message: vAgentMessageInput,
  }),
  v.object({
    type: v.literal("error"),
    error: vAgentError,
  }),
  v.object({
    type: v.literal("done"),
    usage: v.optional(vAgentUsage),
  }),
);
export type AgentRunEvent = Infer<typeof vAgentRunEvent>;

/** Public durable run shape returned by Agent APIs. @public */
export const vPublicRun = v.object({
  runId: v.string(),
  threadId: v.string(),
  userId: v.optional(v.string()),
  agentName: v.string(),
  messageId: v.optional(v.string()),
  resultMessageIds: v.optional(v.array(v.string())),
  streamId: v.string(),
  workflowId: v.optional(v.string()),
  key: v.optional(v.string()),
  status: vAgentStatus,
  waiting: v.optional(vAgentWaiting),
  error: v.optional(vAgentError),
  usage: v.optional(vAgentUsage),
  output: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  finishedAt: v.optional(v.number()),
});
export type PublicRun = Infer<typeof vPublicRun>;

/** Tool-call state projected from Agent run events. @public */
export const vAgentToolCall = v.object({
  toolCallId: v.string(),
  runId: v.string(),
  name: v.string(),
  input: v.any(),
  status: vAgentToolStatus,
  approvalId: v.optional(v.string()),
  approved: v.optional(v.boolean()),
  reason: v.optional(v.string()),
  output: v.optional(v.any()),
  error: v.optional(vAgentError),
  requestedAt: v.number(),
  resolvedAt: v.optional(v.number()),
});
export type AgentToolCall = Infer<typeof vAgentToolCall>;

/** Public persisted message shape returned by Agent message APIs. @public */
export const vAgentMessageDoc = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  userId: v.optional(v.string()),
  threadId: v.string(),
  order: v.number(),
  stepOrder: v.number(),
  error: v.optional(v.string()),
  status: vMessageStatus,
  agentName: v.optional(v.string()),
  clientKey: v.optional(v.string()),
  message: v.optional(vAgentMessage),
  tool: v.boolean(),
  text: v.optional(v.string()),
  usage: v.optional(vAgentUsage),
});
export type AgentMessageDoc = Infer<typeof vAgentMessageDoc>;

export const vThreadDoc = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  userId: v.optional(v.string()),
  title: v.optional(v.string()),
  summary: v.optional(v.string()),
  status: vThreadStatus,
});
export type ThreadDoc = Infer<typeof vThreadDoc>;
