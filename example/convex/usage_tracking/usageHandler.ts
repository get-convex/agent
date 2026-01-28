// See the docs at https://docs.convex.dev/agents/usage-tracking
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { UsageHandler, vProviderMetadata } from "@convex-dev/agent";
import { internal } from "../_generated/api";

export function getBillingPeriod(at: number) {
  const now = new Date(at);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth());
  return startOfMonth.toISOString().split("T")[0];
}

export const usageHandler: UsageHandler = async (ctx, args) => {
  if (!args.userId) {
    console.debug("Not tracking usage for anonymous user");
    return;
  }
  await ctx.runMutation(internal.usage_tracking.usageHandler.insertRawUsage, {
    userId: args.userId,
    agentName: args.agentName,
    model: args.model,
    provider: args.provider,
    usage: args.usage,
    providerMetadata: args.providerMetadata,
  });
};

export const insertRawUsage = internalMutation({
  args: {
    userId: v.string(),
    agentName: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    usage: v.object({
      totalTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      cachedInputTokens: v.optional(v.number()),
      // AI SDK v6 detailed token breakdown fields
      inputTokenDetails: v.optional(
        v.object({
          noCacheTokens: v.optional(v.number()),
          cacheReadTokens: v.optional(v.number()),
          cacheWriteTokens: v.optional(v.number()),
        })
      ),
      outputTokenDetails: v.optional(
        v.object({
          textTokens: v.optional(v.number()),
          reasoningTokens: v.optional(v.number()),
        })
      ),
      // Provider-specific raw usage data (varies by provider)
      raw: v.optional(v.any()),
    }),
    providerMetadata: v.optional(vProviderMetadata),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("rawUsage", {
      ...args,
      billingPeriod: getBillingPeriod(Date.now()),
      usage: {
        promptTokens: args.usage.inputTokens ?? 0,
        completionTokens: args.usage.outputTokens ?? 0,
        totalTokens: args.usage.totalTokens ?? 0,
        reasoningTokens: args.usage.reasoningTokens,
        cachedInputTokens: args.usage.cachedInputTokens,
      },
    });
  },
});
