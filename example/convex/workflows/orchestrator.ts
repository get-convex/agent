// See the docs at https://docs.convex.dev/agents/workflows
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import {
  Agent,
  createThread,
  saveMessage,
  stepCountIs,
} from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { weatherAgent } from "../agents/weather";
import { fashionAgent } from "../agents/fashion";
import { storyAgent } from "../agents/story";
import { agent as simpleAgent } from "../agents/simple";
import { z } from "zod/v4";
import { defaultConfig } from "convex/agents/config";

/**
 * Orchestrator Pattern: One agent decides what to do and composes other agents
 *
 * This workflow demonstrates using an LLM to route a user request to the
 * appropriate specialist agent, then executing that agent's workflow.
 */

const workflow = new WorkflowManager(components.workflow);

export const orchestratorWorkflow = workflow.define({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, args): Promise<string> => {
    // Step 1: Use an LLM to determine which agent should handle the request
    const { object: routing } = await ctx.runAction(
      internal.workflows.orchestrator.routeRequest,
      { prompt: args.prompt },
      { retry: true },
    );

    console.log("Routing decision:", routing);

    // Step 2: Execute the appropriate agent based on the routing decision
    const questionMsg = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: args.prompt,
    });

    let result: string;
    switch (routing.agent) {
      case "weather": {
        const weatherResult = await ctx.runAction(
          internal.workflows.orchestrator.getWeatherInfo,
          { promptMessageId: questionMsg.messageId, threadId: args.threadId },
          { retry: true },
        );
        result = weatherResult.text;
        break;
      }
      case "fashion": {
        const fashionResult = await ctx.runAction(
          internal.workflows.orchestrator.getFashionInfo,
          { promptMessageId: questionMsg.messageId, threadId: args.threadId },
          { retry: true },
        );
        result = fashionResult.text;
        break;
      }
      case "story": {
        const storyResult = await ctx.runAction(
          internal.workflows.orchestrator.getStory,
          { promptMessageId: questionMsg.messageId, threadId: args.threadId },
          { retry: true },
        );
        result = storyResult.text;
        break;
      }
      default: {
        const generalResult = await ctx.runAction(
          internal.workflows.orchestrator.getGeneralResponse,
          { promptMessageId: questionMsg.messageId, threadId: args.threadId },
          { retry: true },
        );
        result = generalResult.text;
        break;
      }
    }

    console.log("Orchestrator result:", result);
    return result;
  },
});

// Routing agent action - decides which specialist to use
const routingAgent = new Agent(components.agent, {
  name: "Routing Agent",
  ...defaultConfig,
  instructions: `You are a routing agent. Analyze the user's request and determine which specialist agent should handle it:
- "weather": For questions about weather, forecasts, or climate
- "fashion": For questions about clothing, style, or what to wear
- "story": For requests to tell a story or create a narrative
- "general": For all other requests

Return the agent name and a brief reason for your choice.`,
});
export const routeRequest = routingAgent.asObjectAction({
  schema: z.object({
    agent: z.union([
      z.literal("weather"),
      z.literal("fashion"),
      z.literal("story"),
      z.literal("general"),
    ]),
    reason: z.string(),
  }),
});

// Specialist agent actions
export const getWeatherInfo = weatherAgent.asTextAction({
  stopWhen: stepCountIs(3),
});

export const getFashionInfo = fashionAgent.asTextAction({
  stopWhen: stepCountIs(5),
});

export const getStory = storyAgent.asTextAction({
  stopWhen: stepCountIs(3),
});

export const getGeneralResponse = simpleAgent.asTextAction({
  stopWhen: stepCountIs(3),
});

// Mutation to start the orchestrator workflow
// TODO: make this a loop until it decides it's done
export const startOrchestrator = mutation({
  args: { prompt: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; workflowId: string }> => {
    const userId = await getAuthUserId(ctx);
    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: "Orchestrator: " + args.prompt.slice(0, 50),
    });
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.orchestrator.orchestratorWorkflow,
      { prompt: args.prompt, threadId },
    );
    return { threadId, workflowId };
  },
});
