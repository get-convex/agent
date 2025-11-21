// See the docs at https://docs.convex.dev/agents/workflows
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { createThread, saveMessage, stepCountIs } from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { weatherAgent } from "../agents/weather";
import { fashionAgent } from "../agents/fashion";

/**
 * Parallel Pattern: Execute multiple workflows concurrently and combine results
 *
 * This workflow demonstrates kicking off parallel nested workflows to do
 * multiple things at once, then combining their results.
 */

const workflow = new WorkflowManager(components.workflow);

export const parallelWorkflow = workflow.define({
  args: { location: v.string(), threadId: v.string() },
  returns: v.object({
    weather: v.string(),
    fashion: v.string(),
    summary: v.string(),
  }),
  handler: async (ctx, args) => {
    console.log("Starting parallel workflow for", args.location);

    // Kick off multiple nested workflows in parallel
    const weatherWorkflowId = await ctx.runWorkflow(
      internal.workflows.parallel.weatherSubWorkflow,
      { location: args.location, threadId: args.threadId },
    );

    const fashionWorkflowId = await ctx.runWorkflow(
      internal.workflows.parallel.fashionSubWorkflow,
      { location: args.location, threadId: args.threadId },
    );

    console.log("Weather result:", weatherWorkflowId);
    console.log("Fashion result:", fashionWorkflowId);

    // Now combine the results with a summary
    const summary = await ctx.runAction(
      internal.workflows.parallel.summarizeResults,
      {
        threadId: args.threadId,
        weather: weatherWorkflowId,
        fashion: fashionWorkflowId,
      },
      { retry: true },
    );

    return {
      weather: weatherWorkflowId,
      fashion: fashionWorkflowId,
      summary,
    };
  },
});

// Sub-workflow for weather information
export const weatherSubWorkflow = workflow.define({
  args: { location: v.string(), threadId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const questionMsg = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: `What is the weather forecast for ${args.location}?`,
    });

    const result = await ctx.runAction(
      internal.workflows.parallel.getWeather,
      {
        promptMessageId: questionMsg.messageId,
        threadId: args.threadId,
      },
      { retry: true },
    );

    return result;
  },
});

// Sub-workflow for fashion advice
export const fashionSubWorkflow = workflow.define({
  args: { location: v.string(), threadId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const questionMsg = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: `Based on the weather discussion, what should someone wear in ${args.location}?`,
    });

    const result = await ctx.runAction(
      internal.workflows.parallel.getFashion,
      {
        promptMessageId: questionMsg.messageId,
        threadId: args.threadId,
      },
      { retry: true },
    );

    return result;
  },
});

// Agent actions
export const getWeather = weatherAgent.asTextAction({
  stopWhen: stepCountIs(3),
});

export const getFashion = fashionAgent.asTextAction({
  stopWhen: stepCountIs(5),
});

export const summarizeResults = weatherAgent.asTextAction({
  instructions:
    "You are a helpful assistant. Summarize the weather and fashion advice from the conversation history into a concise travel recommendation.",
  stopWhen: stepCountIs(2),
});

// Mutation to start the parallel workflow
export const startParallel = mutation({
  args: { location: v.string() },
  handler: async (ctx, args): Promise<{ threadId: string; workflowId: string }> => {
    const userId = await getAuthUserId(ctx);
    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: `Parallel: ${args.location}`,
    });
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.parallel.parallelWorkflow,
      { location: args.location, threadId },
    );
    return { threadId, workflowId };
  },
});
