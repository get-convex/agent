// See the docs at https://docs.convex.dev/agents/usage-tracking
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { UsageHandler, vProviderMetadata, vUsage } from "@convex-dev/agent";
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
    usage: {
      inputTokens: args.usage.inputTokens ?? 0,
      outputTokens: args.usage.outputTokens ?? 0,
      totalTokens: args.usage.totalTokens ?? 0,
      reasoningTokens: args.usage.reasoningTokens,
      cachedInputTokens: args.usage.cachedInputTokens,
    },
    providerMetadata: args.providerMetadata,
  });
};

export const insertRawUsage = internalMutation({
  args: {
    userId: v.string(),
    agentName: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    usage: vUsage,
    providerMetadata: v.optional(vProviderMetadata),
  },
  handler: async (ctx, args) => {
    const billingPeriod = getBillingPeriod(Date.now());
    return await ctx.db.insert("rawUsage", {
      ...args,
      billingPeriod,
    });
  },
});
