import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  costPerRequest: defineTable({
    userId: v.optional(v.string()),
    threadId: v.string(),
    messageId: v.string(),
    cost: v.object({
      promptTokensCost: v.number(),
      completionTokensCost: v.number(),
      reasoningTokensCost: v.optional(v.number()),
      cachedInputTokensCost: v.optional(v.number()),
      totalTokensCost: v.number(),
    }),
  }),
  pricingTables: defineTable({
    providerId: v.string(),
    providerName: v.string(),
    modelId: v.string(),
    modelName: v.string(),
    pricing: v.object({
      input: v.number(),
      output: v.number(),
      reasoning: v.optional(v.number()),
      cache_read: v.optional(v.number()),
      cache_write: v.optional(v.number()),
    }),
    limits: v.object({
      context: v.number(),
      output: v.number(),
    }),
    lastUpdated: v.number(),
  }).index("by_model_id", ["modelId"])
    .index("by_provider", ["providerId"]),
});
