import {
  action,
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Internal action to update pricing data - called by cron jobs
 */
export const updatePricingData = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const response = await fetch("https://models.dev/api.json");

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const pricingUpdates = [];

      // Process each provider
      for (const [providerId, providerData] of Object.entries(data)) {
        if (
          typeof providerData !== "object" ||
          !providerData ||
          !(providerData as any).models
        ) {
          continue;
        }

        const provider = providerData as any;

        // Process each model within the provider
        for (const [modelId, modelData] of Object.entries(provider.models)) {
          if (typeof modelData !== "object" || !modelData) {
            continue;
          }

          const model = modelData as any;

          // Extract pricing information
          const pricing = {
            input: model.cost?.input || 0,
            output: model.cost?.output || 0,
            reasoning: model.cost?.reasoning,
            cache_read: model.cost?.cache_read,
            cache_write: model.cost?.cache_write,
          };

          // Extract limits information
          const limits = {
            context: model.limit?.context || 0,
            output: model.limit?.output || 0,
          };

          pricingUpdates.push({
            providerId,
            providerName: provider.name || providerId,
            modelId,
            modelName: model.name || modelId,
            pricing,
            limits,
            lastUpdated: Date.now(),
          });
        }
      }

      // Update the pricing table
      await ctx.runMutation(internal.pricing.updatePricingTable, {
        pricingData: pricingUpdates,
      });

      console.log(`Updated pricing for ${pricingUpdates.length} models`);

      console.log(`Updated pricing for ${pricingUpdates.length} models`);
      return { updatedModels: pricingUpdates.length };
    } catch (error) {
      console.error("Failed to update pricing data:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update pricing data: ${errorMessage}`);
    }
  },
});

/**
 * Internal mutation to update the pricing table
 */
export const updatePricingTable = internalMutation({
  args: {
    pricingData: v.array(
      v.object({
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
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Clear existing pricing data (we'll do a full refresh each time)
    const existingPricing = await ctx.db.query("pricingTables").collect();
    for (const pricing of existingPricing) {
      await ctx.db.delete(pricing._id);
    }

    // Insert new pricing data
    for (const pricingEntry of args.pricingData) {
      await ctx.db.insert("pricingTables", pricingEntry);
    }
  },
});

/**
 * Query to get pricing for a specific model
 */
export const getPricing = query({
  args: {
    modelId: v.string(),
  },
  handler: async (ctx, args) => {
    const pricing = await ctx.db
      .query("pricingTables")
      .withIndex("by_model_id", (q) => q.eq("modelId", args.modelId))
      .first();

    return pricing;
  },
});

/**
 * Query to get all pricing data
 */
export const getAllPricing = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("pricingTables").collect();
  },
});

/**
 * Query to get pricing data for a specific provider
 */
export const getPricingByProvider = query({
  args: {
    providerId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pricingTables")
      .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
      .collect();
  },
});
