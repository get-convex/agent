// See the docs at https://docs.convex.dev/agents/workflows
import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import {
  defineEvent,
  type WorkflowId,
  WorkflowManager,
  vWorkflowId,
} from "@convex-dev/workflow";
import { type Infer, v } from "convex/values";
import { z } from "zod/v3";
import { components, internal } from "../_generated/api.js";
import { action, mutation, query } from "../_generated/server.js";
import { defaultConfig } from "../agents/config.js";

const resultValidator = v.object({
  steps: v.array(v.object({ agent: v.string(), output: v.string() })),
});

type ExampleResult = Infer<typeof resultValidator>;

const standaloneScope = { userId: "advanced-workflow-example" };

const analystAgent = new Agent(components.agent, {
  name: "Analyst",
  instructions:
    "Analyze the request using concrete facts, constraints, and tradeoffs. Keep responses under 120 words.",
  ...defaultConfig,
});

const creativeAgent = new Agent(components.agent, {
  name: "Creative",
  instructions:
    "Generate practical, original options for the request. Keep responses under 120 words.",
  ...defaultConfig,
});

const criticAgent = new Agent(components.agent, {
  name: "Critic",
  instructions:
    "Find risks, weak assumptions, and useful improvements. Keep responses under 120 words.",
  ...defaultConfig,
});

const coordinatorAgent = new Agent(components.agent, {
  name: "Coordinator",
  instructions:
    "Coordinate specialists and produce concise, actionable answers. Keep responses under 160 words.",
  ...defaultConfig,
});

const reactAgent = new Agent(components.agent, {
  name: "ReAct Agent",
  instructions:
    "Reason about the request, call both available tools, then give a concise recommendation based on their results.",
  tools: {
    lookupProjectFacts: createTool({
      description: "Look up fixed facts about the example software project",
      inputSchema: z.object({
        focus: z.string().describe("The project area to inspect"),
      }),
      execute: async (_ctx, { focus }) => ({
        focus,
        teamSize: 3,
        releaseWindowDays: 10,
        constraints: ["No new service", "Keep the first release small"],
      }),
    }),
    estimateEffort: createTool({
      description:
        "Estimate implementation days from task count and complexity",
      inputSchema: z.object({
        tasks: z.number().int().positive(),
        complexity: z.enum(["low", "medium", "high"]),
      }),
      execute: async (_ctx, { tasks, complexity }) => ({
        days: Math.ceil(tasks * { low: 0.5, medium: 1, high: 2 }[complexity]),
      }),
    }),
  },
  stopWhen: stepCountIs(5),
  ...defaultConfig,
});

const specialists = {
  analyst: analystAgent,
  creative: creativeAgent,
  critic: criticAgent,
};

/** Route a request with one LLM call, then invoke only the selected agent. */
export const dynamicRouting = action({
  args: { prompt: v.string() },
  returns: resultValidator,
  handler: async (ctx, { prompt }): Promise<ExampleResult> => {
    const {
      object: { route },
    } = await coordinatorAgent.generateObject(ctx, standaloneScope, {
      prompt: `Choose the best specialist for this request: ${prompt}`,
      schema: z.object({
        route: z.enum(["analyst", "creative", "critic"]),
      }),
    });
    const response = await specialists[route].generateText(
      ctx,
      standaloneScope,
      { prompt },
    );
    return {
      steps: [
        { agent: "Router", output: `Selected ${route}` },
        { agent: route, output: response.text },
      ],
    };
  },
});

/** Run independent specialists in parallel, then synthesize their reports. */
export const fanOut = action({
  args: { prompt: v.string() },
  returns: resultValidator,
  handler: async (ctx, { prompt }): Promise<ExampleResult> => {
    const reports = await Promise.all(
      Object.entries(specialists).map(async ([name, agent]) => ({
        agent: name,
        output: (await agent.generateText(ctx, standaloneScope, { prompt }))
          .text,
      })),
    );
    const combined = await coordinatorAgent.generateText(ctx, standaloneScope, {
      prompt: `Combine these specialist reports into one answer to "${prompt}":\n\n${reports
        .map(({ agent, output }) => `${agent}: ${output}`)
        .join("\n\n")}`,
    });
    return {
      steps: [...reports, { agent: "coordinator", output: combined.text }],
    };
  },
});

/** Give agents distinct sequential responsibilities in one controlled flow. */
export const orchestrate = action({
  args: { prompt: v.string() },
  returns: resultValidator,
  handler: async (ctx, { prompt }): Promise<ExampleResult> => {
    const plan = await coordinatorAgent.generateText(ctx, standaloneScope, {
      prompt: `Create a short plan for answering: ${prompt}`,
    });
    const analysis = await analystAgent.generateText(ctx, standaloneScope, {
      prompt: `Execute this plan for "${prompt}":\n${plan.text}`,
    });
    const critique = await criticAgent.generateText(ctx, standaloneScope, {
      prompt: `Review this analysis and name the important corrections:\n${analysis.text}`,
    });
    const final = await coordinatorAgent.generateText(ctx, standaloneScope, {
      prompt: `Answer "${prompt}" using this analysis and critique.\n\nAnalysis: ${analysis.text}\n\nCritique: ${critique.text}`,
    });
    return {
      steps: [
        { agent: "coordinator", output: plan.text },
        { agent: "analyst", output: analysis.text },
        { agent: "critic", output: critique.text },
        { agent: "coordinator", output: final.text },
      ],
    };
  },
});

/** Let the model alternate between reasoning and deterministic tool actions. */
export const reasonAndAct = action({
  args: { prompt: v.string() },
  returns: resultValidator,
  handler: async (ctx, { prompt }): Promise<ExampleResult> => {
    const response = await reactAgent.generateText(ctx, standaloneScope, {
      prompt,
    });
    return { steps: [{ agent: "ReAct agent", output: response.text }] };
  },
});

/** Let several agents contribute to the same persistent conversation thread. */
export const agentNetwork = action({
  args: { prompt: v.string() },
  returns: resultValidator,
  handler: async (ctx, { prompt }): Promise<ExampleResult> => {
    const { threadId } = await coordinatorAgent.createThread(ctx, {
      userId: standaloneScope.userId,
      title: `Agent network: ${prompt}`,
    });
    const turns = [
      ["analyst", analystAgent, `Analyze this request: ${prompt}`],
      [
        "creative",
        creativeAgent,
        "Read the earlier analysis in this thread and propose better options.",
      ],
      [
        "critic",
        criticAgent,
        "Review the earlier messages and identify the strongest option and its main risk.",
      ],
      [
        "coordinator",
        coordinatorAgent,
        "Use the full discussion in this thread to give the final answer.",
      ],
    ] as const;
    const steps: ExampleResult["steps"] = [];
    for (const [agentName, agent, turnPrompt] of turns) {
      const response = await agent.generateText(
        ctx,
        { threadId },
        { prompt: turnPrompt },
      );
      steps.push({ agent: agentName, output: response.text });
    }
    return { steps };
  },
});

const workflow = new WorkflowManager(components.workflow);
const revisionRequested = defineEvent({
  name: "revisionRequested",
  validator: v.string(),
});

export const writeForReview = coordinatorAgent.asTextAction({});

/** Pause durably until feedback arrives, then resume from the recorded step. */
export const reviewWorkflow = workflow.define({
  args: { prompt: v.string() },
  returns: v.string(),
  handler: async (step, { prompt }): Promise<string> => {
    const { text: draft } = await step.runAction(
      internal.workflows.coordination.writeForReview,
      {
        userId: standaloneScope.userId,
        prompt: `Write a short draft for: ${prompt}`,
      },
      { name: "writeDraft", retry: true },
    );
    const feedback = await step.awaitEvent(revisionRequested);
    const { text: revision } = await step.runAction(
      internal.workflows.coordination.writeForReview,
      {
        userId: standaloneScope.userId,
        prompt: `Revise this draft using the feedback.\n\nDraft: ${draft}\n\nFeedback: ${feedback}`,
      },
      { name: "reviseDraft", retry: true },
    );
    return revision;
  },
});

export const startReviewWorkflow = mutation({
  args: { prompt: v.string() },
  returns: vWorkflowId,
  handler: (ctx, { prompt }): Promise<WorkflowId> =>
    workflow.start(
      ctx,
      internal.workflows.coordination.reviewWorkflow,
      { prompt },
      { startAsync: true },
    ),
});

export const resumeReviewWorkflow = mutation({
  args: { workflowId: vWorkflowId, feedback: v.string() },
  returns: v.null(),
  handler: async (ctx, { workflowId, feedback }) => {
    await workflow.sendEvent(ctx, {
      ...revisionRequested,
      workflowId,
      value: feedback,
    });
    return null;
  },
});

export const reviewWorkflowStatus = query({
  args: { workflowId: vWorkflowId },
  returns: v.union(
    v.object({
      state: v.union(v.literal("running"), v.literal("waiting")),
    }),
    v.object({ state: v.literal("completed"), result: v.string() }),
    v.object({ state: v.literal("failed"), error: v.string() }),
    v.object({ state: v.literal("canceled") }),
  ),
  handler: async (ctx, { workflowId }) => {
    const status = await workflow.status(ctx, workflowId);
    switch (status.type) {
      case "inProgress":
        return {
          state: status.running.some((step) => step.kind === "event")
            ? ("waiting" as const)
            : ("running" as const),
        };
      case "completed":
        if (typeof status.result !== "string") {
          throw new Error("Review workflow returned a non-string result");
        }
        return { state: "completed" as const, result: status.result };
      case "failed":
        return { state: "failed" as const, error: status.error };
      case "canceled":
        return { state: "canceled" as const };
      default:
        return status satisfies never;
    }
  },
});
