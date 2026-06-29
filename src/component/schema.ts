import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vThreadStatus,
  vAgentMessage,
  vMessageStatus,
  vAgentUsage,
  vAgentError,
  vAgentStatus,
  vAgentWaiting,
  vAgentToolStatus,
} from "../validators.js";
import { typedV } from "convex-helpers/validators";

export const schema = defineSchema({
  threads: defineTable({
    userId: v.optional(v.string()), // Unset for anonymous
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    status: vThreadStatus,
  })
    .index("userId", ["userId"])
    .searchIndex("title", { searchField: "title", filterFields: ["userId"] }),
  messages: defineTable({
    userId: v.optional(v.string()), // useful for searching across threads
    threadId: v.id("threads"),
    order: v.number(),
    stepOrder: v.number(),
    error: v.optional(v.string()),
    status: vMessageStatus,

    // Context on how it was produced inside Agent.
    agentName: v.optional(v.string()),
    clientKey: v.optional(v.string()),

    // Agent-native message node.
    message: v.optional(vAgentMessage),
    // Convenience fields extracted from the message
    tool: v.boolean(),
    text: v.optional(v.string()),

    // Result metadata
    usage: v.optional(vAgentUsage),
    parentMessageId: v.optional(v.id("messages")),
  })
    // Allows finding successful visible messages in order while still surfacing
    // pending/tool messages separately.
    .index("threadId_status_tool_order_stepOrder", [
      "threadId",
      "status",
      "tool",
      "order",
      "stepOrder",
    ])
    // Allows text search on message content
    .searchIndex("text_search", {
      searchField: "text",
      filterFields: ["userId", "threadId"],
    }),

  runs: defineTable({
    threadId: v.id("threads"),
    userId: v.optional(v.string()),
    agentName: v.string(),
    messageId: v.optional(v.id("messages")),
    resultMessageIds: v.optional(v.array(v.id("messages"))),
    streamId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    key: v.optional(v.string()),
    requestHash: v.optional(v.string()),
    executionId: v.optional(v.string()),
    executionLeaseExpiresAt: v.optional(v.number()),
    nextEventSequence: v.number(),
    status: vAgentStatus,
    waiting: v.optional(vAgentWaiting),
    error: v.optional(vAgentError),
    usage: v.optional(vAgentUsage),
    output: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("agentName_threadId_key", ["agentName", "threadId", "key"])
    .index("threadId_status_createdAt", ["threadId", "status", "createdAt"])
    .index("threadId_createdAt", ["threadId", "createdAt"]),

  runToolCalls: defineTable({
    runId: v.id("runs"),
    toolCallId: v.string(),
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
    updatedAt: v.number(),
  })
    .index("runId_toolCallId", ["runId", "toolCallId"])
    .index("runId_status", ["runId", "status"])
    .index("runId_requestedAt", ["runId", "requestedAt"]),
});

export const vv = typedV(schema);
export { vv as v };

export default schema;
