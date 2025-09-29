// Implementation for tracking price per request using pricing table
import { v } from "convex/values";
import { vUsage } from "../validators.js";
import { mutation, query } from "./_generated/server.js";

// Mutation to calculate and save price per request using pricing table
export const addUsage = mutation({
  args: {
    messageId: v.id("messages"),
    userId: v.optional(v.string()),
    threadId: v.id("threads"),
    usage: vUsage,
    model: v.string(),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("usagePerRequest", {
      ...args,
    });
  },
});
// Query to get all usage records
export const getAllUsage = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("usagePerRequest").collect();
  },
});

// Query to get usage by thread ID
export const getUsageByThreadId = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("usagePerRequest")
      .withIndex("threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

// Query to get usage by message ID
export const getUsageByMessageId = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("usagePerRequest")
      .withIndex("messageId", (q) => q.eq("messageId", args.messageId))
      .collect();
  },
});

// Query to get usage by ID
export const getUsageById = query({
  args: { id: v.id("usagePerRequest") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Query to get usage by thread and message ID
export const getUsageByThreadAndMessageId = query({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("usagePerRequest")
      .filter((q) =>
        q.and(
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("messageId"), args.messageId),
        ),
      )
      .collect();
  },
});

// Query to get usage by user ID
export const getUsageByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("usagePerRequest")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// Query to get usage by model
export const getUsageByModel = query({
  args: { model: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("usagePerRequest")
      .filter((q) => q.eq(q.field("model"), args.model))
      .collect();
  },
});

// Query to get usage by provider
export const getUsageByProvider = query({
  args: { provider: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("usagePerRequest")
      .filter((q) => q.eq(q.field("provider"), args.provider))
      .collect();
  },
});

// Mutation to update usage
export const updateUsage = mutation({
  args: {
    id: v.id("usagePerRequest"),
    messageId: v.optional(v.id("messages")),
    userId: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    usage: v.optional(vUsage),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    return await ctx.db.patch(id, updates);
  },
});

// Mutation to delete usage
export const deleteUsage = mutation({
  args: { id: v.id("usagePerRequest") },
  handler: async (ctx, args) => {
    return await ctx.db.delete(args.id);
  },
});

// Query to get total usage aggregated by model
export const getTotalUsageByThreadId = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const threadUsage = await ctx.db
      .query("usagePerRequest")
      .withIndex("threadId", (q) => q.eq("threadId", args.threadId))
      .collect();

    const totalUsage = threadUsage.reduce(
      (acc, record) => {
        acc.totalTokens += record.usage.totalTokens || 0;
        acc.totalRequests += 1;
        return acc;
      },
      { totalTokens: 0, totalRequests: 0 },
    );

    return totalUsage;
  },
});
