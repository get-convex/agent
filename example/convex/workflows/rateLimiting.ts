// See the docs at https://docs.convex.dev/agents/workflows
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { createThread, saveMessage, stepCountIs } from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { weatherAgent } from "../agents/weather";
import { RateLimiter, SECOND } from "@convex-dev/rate-limiter";

/**
 * Rate Limiting Pattern: Using rate limiter within workflows
 *
 * This workflow demonstrates using the rate limiter component from a workflow
 * and using the returned runAfter to schedule the next step with proper delays.
 */

const workflow = new WorkflowManager(components.workflow);

// Create a rate limiter for API calls
export const apiRateLimiter = new RateLimiter(components.rateLimiter, {
  weatherApiCalls: {
    kind: "token bucket",
    period: 10 * SECOND,
    rate: 3, // 3 calls per 10 seconds
    capacity: 3,
  },
});

export const rateLimitedWorkflow = workflow.define({
  args: { locations: v.array(v.string()), threadId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    console.log(
      "Starting rate-limited workflow for locations:",
      args.locations,
    );

    const results: string[] = [];

    // Process each location with rate limiting
    for (const location of args.locations) {
      console.log("Processing location:", location);

      // Check the rate limit before making the API call
      const rateLimit = await apiRateLimiter.check(ctx, "weatherApiCalls", {
        key: "workflow-user",
      });

      console.log("Rate limit check:", rateLimit);

      // If we need to wait, use runAfter to schedule the next step
      let runAfter: number | undefined = undefined;
      if (!rateLimit.ok && rateLimit.retryAfter) {
        console.log(
          `Rate limit hit, scheduling after ${rateLimit.retryAfter}ms`,
        );
        runAfter = rateLimit.retryAfter;
      }

      // Save the question message
      const questionMsg = await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        prompt: `What is the weather in ${location}?`,
      });

      // Make the API call with rate limiting
      await apiRateLimiter.limit(ctx, "weatherApiCalls", {
        key: "workflow-user",
        reserve: true,
      });
      const { text: result } = await ctx.runAction(
        internal.workflows.rateLimiting.getWeatherWithRateLimit,
        {
          promptMessageId: questionMsg.messageId,
          threadId: args.threadId,
          userId: "workflow-user",
        },
        {
          retry: true,
          runAfter, // Schedule after rate limit window
        },
      );

      results.push(result);
      console.log(`Completed ${location}:`, result);
    }

    // Summarize all the weather reports
    const summaryMsg = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: "Summarize all the weather information from our conversation.",
    });

    const { text: summary } = await ctx.runAction(
      internal.workflows.rateLimiting.summarize,
      {
        promptMessageId: summaryMsg.messageId,
        threadId: args.threadId,
      },
      { retry: true },
    );

    results.push(summary);
    return results;
  },
});

// Check rate limit mutation
export const checkRateLimit = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await apiRateLimiter.check(ctx, "weatherApiCalls", {
      key: args.userId,
    });
  },
});

// Weather agent action with rate limiting
export const getWeatherWithRateLimit = weatherAgent.asTextAction({
  stopWhen: stepCountIs(3),
});

// Summarization action
export const summarize = weatherAgent.asTextAction({
  stopWhen: stepCountIs(2),
});

// Mutation to start the rate-limited workflow
export const startRateLimited = mutation({
  args: { locations: v.array(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; workflowId: string }> => {
    const userId = await getAuthUserId(ctx);
    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: `Rate Limited: ${args.locations.join(", ")}`,
    });
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.rateLimiting.rateLimitedWorkflow,
      { locations: args.locations, threadId },
    );
    return { threadId, workflowId };
  },
});
