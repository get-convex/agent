// See the docs at https://docs.convex.dev/agents/rate-limiting
import { Agent, saveMessage, UsageHandler } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import { chat, textEmbedding } from "../modelsForDemo";
import { internalAction, mutation } from "../_generated/server";
import { v } from "convex/values";
import { MINUTE, RateLimiter, SECOND } from "@convex-dev/rate-limiter";
import { usageHandler as normalUsageHandler } from "../usage_tracking/usageHandler";
import { getAuthUserId } from "../utils";
import { authorizeThreadAccess } from "../threads";
import { estimateTokens } from "./utils";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  sendMessage: {
    kind: "fixed window",
    period: 5 * SECOND,
    rate: 1,
    // Allow accruing usage up to 2 messages to send within 5s (rollover).
    capacity: 2,
  },
  tokenUsagePerUser: {
    kind: "token bucket",
    period: MINUTE,
    rate: 2000,
    capacity: 10000,
  },
  globalSendMessage: { kind: "token bucket", period: MINUTE, rate: 1_000 },
  globalTokenUsage: { kind: "token bucket", period: MINUTE, rate: 100_000 },
});

export const rateLimitedUsageHandler: UsageHandler = async (ctx, args) => {
  if (!args.userId) {
    console.warn("No user ID found in usage handler");
    return;
  }
  // We consume the token usage here, once we know the full usage.
  // This is too late for the first generation, but prevents further requests
  // until we've paid off that debt.
  await rateLimiter.limit(ctx, "tokenUsagePerUser", {
    key: args.userId,
    // You could weight different kinds of tokens differently here.
    count: args.usage.totalTokens,
    // Reserving the tokens means it won't fail here, but will allow it
    // to go negative, disallowing further requests at the `check` call below.
    reserve: true,
  });
  // Also track global usage.
  await rateLimiter.limit(ctx, "globalTokenUsage", {
    count: args.usage.totalTokens,
    reserve: true,
  });

  // The usage handler used in other demos that tracks usage for billing / etc.
  await normalUsageHandler(ctx, args);
};

export const rateLimitedAgent = new Agent(components.agent, {
  name: "Rate Limited Agent",
  chat,
  usageHandler: rateLimitedUsageHandler,
  // Optional:
  textEmbedding,
});

// Step 1: Submit a question. It checks to see if you are exceeding rate limits.
export const submitQuestion = mutation({
  args: {
    question: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }
    await authorizeThreadAccess(ctx, args.threadId);

    await rateLimiter.limit(ctx, "sendMessage", { key: userId, throws: true });
    // Also check global limit.
    await rateLimiter.limit(ctx, "globalSendMessage", { throws: true });

    const count = await estimateTokens(ctx, args.threadId, args.question);
    // We only check the limit here, we don't consume the tokens.
    // We track the total usage after it finishes, which is too late for the
    // first generation, but prevents further requests until we've paid off that
    // debt.
    await rateLimiter.check(ctx, "tokenUsagePerUser", {
      key: userId,
      count,
      reserve: true,
      throws: true,
    });
    // Also check global limit.
    await rateLimiter.check(ctx, "globalTokenUsage", {
      count,
      reserve: true,
      throws: true,
    });

    // Save the message and generate a response asynchronously.
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: args.question,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.rate_limiting.rateLimiting.generateResponse,
      { threadId: args.threadId, promptMessageId: messageId },
    );
  },
});

// Step 2: Generate a response asynchronously.
export const generateResponse = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, args) => {
    // Because the agent has a usage handler that will use the rate limiter, we
    // don't need to do anything special here.
    await rateLimitedAgent.generateText(
      ctx,
      { threadId: args.threadId },
      { promptMessageId: args.promptMessageId },
    );
  },
});
