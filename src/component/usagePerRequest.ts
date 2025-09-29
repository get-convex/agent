// Implementation for tracking price per request using pricing table
import { v } from "convex/values";
import { vUsage } from "../validators.js";
import { mutation } from "./_generated/server.js";

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
