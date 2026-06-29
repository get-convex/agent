import { defineSchema } from "convex/server";
import { defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  cases: defineTable({
    userId: v.string(),
    threadId: v.string(),
    title: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("drafting"),
      v.literal("needsApproval"),
      v.literal("resolved"),
    ),
    active: v.boolean(),
    lastRunId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_active", ["userId", "active"])
    .index("by_user_threadId", ["userId", "threadId"]),
  caseRuns: defineTable({
    userId: v.string(),
    clientMessageId: v.string(),
    scenario: v.string(),
    title: v.string(),
    runId: v.string(),
    threadId: v.string(),
    messageId: v.optional(v.string()),
    streamId: v.string(),
    workflowId: v.optional(v.string()),
    fileRefs: v.array(v.id("files")),
    clientIp: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    requestId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user_clientMessageId", ["userId", "clientMessageId"])
    .index("by_runId", ["runId"]),
  files: defineTable({
    userId: v.string(),
    filename: v.string(),
    mediaType: v.string(),
    summary: v.string(),
    extractedText: v.optional(v.string()),
    extractionStatus: v.optional(
      v.union(
        v.literal("extracted"),
        v.literal("metadataOnly"),
        v.literal("failed"),
      ),
    ),
    textLength: v.optional(v.number()),
    truncated: v.optional(v.boolean()),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    size: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user_createdAt", ["userId", "createdAt"]),
  contextBlocks: defineTable({
    userId: v.string(),
    runId: v.string(),
    source: v.string(),
    name: v.optional(v.string()),
    text: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_user_runId", ["userId", "runId"]),
  knowledgeSeeds: defineTable({
    userId: v.string(),
    version: v.string(),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_user_version", ["userId", "version"]),
});
