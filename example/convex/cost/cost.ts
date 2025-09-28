import { action, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { Usage, vUsage } from "@convex-dev/agent";
import { Doc } from "./_generated/dataModel";

const MILLION = 1_000_000;

export const addCost = action({
  args: {
    messageId: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    usage: vUsage,
    modelId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get pricing for the model
    const pricing = await ctx.runQuery(api.pricing.getPricing, {
      modelId: args.modelId,
    });

    if (!pricing) {
      console.warn(`No pricing found for modelId: ${args.modelId}`);
      return;
    }

    // Calculate actual costs using pricing data
    const calculatedCosts = calculateCosts(args.usage, pricing);

    await ctx.runMutation(internal.cost.addCostInternal, {
      ...args,
      calculatedCosts,
    });
  },
});

export const addCostInternal = internalMutation({
  args: {
    messageId: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    usage: vUsage,
    modelId: v.string(),
    calculatedCosts: v.object({
      promptTokensCost: v.number(),
      completionTokensCost: v.number(),
      reasoningTokensCost: v.number(),
      cachedInputTokensCost: v.number(),
      totalTokensCost: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("costPerRequest", {
      userId: args.userId,
      threadId: args.threadId,
      messageId: args.messageId,
      cost: args.calculatedCosts,
    });
  },
});

/**
 * Calculate actual costs based on token usage and pricing
 */
function calculateCosts(usage: Usage, pricing: Doc<"pricingTables">) {
  if (!pricing) {
    // Fallback to token counts if no pricing available
    return {
      promptTokensCost: usage.promptTokens || 0,
      completionTokensCost: usage.completionTokens || 0,
      reasoningTokensCost: usage.reasoningTokens || 0,
      cachedInputTokensCost: usage.cachedInputTokens || 0,
      totalTokensCost: usage.totalTokens || 0,
    };
  }

  // Calculate costs in dollars per million tokens
  const promptCost =
    ((usage.promptTokens || 0) * (pricing.pricing.input || 0)) / MILLION;
  const completionCost =
    ((usage.completionTokens || 0) * (pricing.pricing.output || 0)) / MILLION;
  const reasoningCost =
    ((usage.reasoningTokens || 0) *
      (pricing.pricing.reasoning || pricing.pricing.output || 0)) /
    MILLION;
  const cachedInputCost =
    ((usage.cachedInputTokens || 0) *
      (pricing.pricing.cache_read || pricing.pricing.input * 0.5 || 0)) /
    MILLION;

  return {
    promptTokensCost: promptCost,
    completionTokensCost: completionCost,
    reasoningTokensCost: reasoningCost,
    cachedInputTokensCost: cachedInputCost,
    totalTokensCost:
      promptCost + completionCost + reasoningCost + cachedInputCost,
  };
}
