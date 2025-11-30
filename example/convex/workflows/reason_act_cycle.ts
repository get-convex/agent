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
import { defaultConfig } from "convex/agents/config";
import { z } from "zod/v4";

/**
 * Reason-Act Cycle Pattern: Iterative reasoning and action loop
 *
 * This workflow demonstrates the pattern of:
 * 1. Reasoning to decide what to do next
 * 2. Taking the action(s)
 * 3. Reasoning again based on results
 * 4. Repeat until goal is achieved
 */

const workflow = new WorkflowManager(components.workflow);

export const reasonActCycleWorkflow = workflow.define({
  args: { goal: v.string(), threadId: v.string() },
  returns: v.object({
    cycles: v.number(),
    finalAnswer: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ cycles: number; finalAnswer: string }> => {
    console.log("Starting reason-act cycle for goal:", args.goal);

    let cycleCount = 0;
    const maxCycles = 3;
    let shouldContinue = true;

    // Initial reasoning step
    let reasoningMsg = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: `Goal: ${args.goal}\n\nAnalyze this goal and determine what information or actions you need to accomplish it. Decide on the next action.`,
    });

    while (shouldContinue && cycleCount < maxCycles) {
      cycleCount++;
      console.log(`Cycle ${cycleCount}: Reasoning`);

      // Step 1: Reason about what to do next
      const { object: reasoning } = await ctx.runAction(
        internal.workflows.reason_act_cycle.reasonAboutNextAction,
        {
          promptMessageId: reasoningMsg.messageId,
          threadId: args.threadId,
        },
        { retry: true },
      );

      console.log("Reasoning result:", reasoning);

      // Step 2: Check if we should continue or if we have the answer
      if (reasoning.action === "answer") {
        shouldContinue = false;
        console.log("Goal achieved, providing final answer");
        break;
      }

      // Step 3: Take the action based on reasoning
      const actionMsg = await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        prompt: `Execute this action: ${reasoning.action}\nRationale: ${reasoning.rationale}`,
      });

      const actionResult = await ctx.runAction(
        internal.workflows.reason_act_cycle.executeAction,
        {
          promptMessageId: actionMsg.messageId,
          threadId: args.threadId,
        },
        { retry: true },
      );

      console.log(`Action result:`, actionResult);

      // Step 4: Reason about the results and decide next steps
      reasoningMsg = await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        prompt: `Based on the action we just took, analyze the results and determine if we've accomplished the goal or what to do next.`,
      });
    }

    // Generate final answer
    const finalMsg = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt:
        "Based on all our reasoning and actions, provide a comprehensive final answer to the original goal.",
    });

    const finalAnswer = await ctx.runAction(
      internal.workflows.reason_act_cycle.generateFinalAnswer,
      {
        promptMessageId: finalMsg.messageId,
        threadId: args.threadId,
      },
      { retry: true },
    );

    return {
      cycles: cycleCount,
      finalAnswer: finalAnswer.text,
    };
  },
});

// Agent action for reasoning about next steps
const reasoningAgent = new Agent(components.agent, {
  name: "Reasoning Agent",
  ...defaultConfig,
  instructions: `You are a reasoning agent. Analyze the conversation and goal, then decide what action to take next:
- "get_weather": If you need weather information
- "get_location": If you need to determine a location
- "analyze_data": If you need to process or analyze information you have
- "answer": If you have enough information to answer the goal

Provide your rationale for the chosen action.`,
});

export const reasonAboutNextAction = reasoningAgent.asObjectAction({
  schema: z.object({
    action: z.enum(["get_weather", "get_location", "analyze_data", "answer"]),
    rationale: z.string(),
  }),
});

// Agent action for executing actions
const actionAgent = new Agent(components.agent, {
  name: "Action Agent",
  ...defaultConfig,
  instructions:
    "Execute the requested action using your available tools and knowledge. Provide detailed results.",
});

export const executeAction = actionAgent.asTextAction({
  stopWhen: stepCountIs(3),
});

// Agent action for generating the final answer
const finalAnswerAgent = new Agent(components.agent, {
  name: "Final Answer Agent",
  ...defaultConfig,
  instructions:
    "Synthesize all the reasoning and actions taken to provide a comprehensive final answer to the original goal.",
});

export const generateFinalAnswer = finalAnswerAgent.asTextAction({
  stopWhen: stepCountIs(2),
});

// Mutation to start the reason-act cycle workflow
export const startReasonActCycle = mutation({
  args: { goal: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; workflowId: string }> => {
    const userId = await getAuthUserId(ctx);
    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: `Reason-Act: ${args.goal.slice(0, 50)}`,
    });
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.reason_act_cycle.reasonActCycleWorkflow,
      { goal: args.goal, threadId },
    );
    return { threadId, workflowId };
  },
});
