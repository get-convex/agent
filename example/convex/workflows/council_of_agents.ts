// See the docs at https://docs.convex.dev/agents/workflows
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { createThread, saveMessage, stepCountIs, Agent } from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { z } from "zod/v4";
import { defaultConfig } from "../agents/config";

/**
 * Council of Agents / Ensemble Pattern: Fan out → Fan in → Select best
 *
 * This workflow demonstrates:
 * 1. Fan out: Multiple agents work on the same problem in parallel
 * 2. Fan in: Collect all responses
 * 3. Select: Either pick the best by score, or synthesize a final answer
 */

const workflow = new WorkflowManager(components.workflow);

// Define council agents inline to keep the demo self-contained
const analystAgent = new Agent(components.agent, {
    name: "Analyst",
    instructions: `You are the Analyst on a council. You focus on:
- Data and evidence-based reasoning
- Logical analysis and structured thinking
- Identifying patterns and root causes
Be thorough and precise in your analysis.`,
    stopWhen: stepCountIs(3),
    ...defaultConfig,
});

const creativeAgent = new Agent(components.agent, {
    name: "Creative",
    instructions: `You are the Creative on a council. You focus on:
- Novel and unconventional solutions
- Thinking outside the box
- Connecting disparate ideas in new ways
Be bold and imaginative in your suggestions.`,
    stopWhen: stepCountIs(3),
    ...defaultConfig,
});

const pragmatistAgent = new Agent(components.agent, {
    name: "Pragmatist",
    instructions: `You are the Pragmatist on a council. You focus on:
- Practical, implementable solutions
- Real-world constraints and trade-offs
- Quick wins and iterative approaches
Be grounded and action-oriented.`,
    stopWhen: stepCountIs(3),
    ...defaultConfig,
});

const judgeAgent = new Agent(components.agent, {
    name: "Judge",
    instructions: `You are an impartial judge. Score responses based on:
- Relevance to the problem
- Quality of reasoning
- Practicality and feasibility
- Completeness of the solution`,
    stopWhen: stepCountIs(3),
    ...defaultConfig,
});

const synthesisAgent = new Agent(components.agent, {
    name: "Synthesizer",
    instructions: `You synthesize multiple perspectives into one cohesive answer.
Extract the best ideas from each response while maintaining consistency.`,
    stopWhen: stepCountIs(3),
    ...defaultConfig,
});

export const councilWorkflow = workflow.define({
    args: {
        problem: v.string(),
        threadId: v.string(),
        mode: v.optional(v.union(v.literal("best"), v.literal("synthesize"))),
    },
    returns: v.object({
        responses: v.array(
            v.object({
                agent: v.string(),
                response: v.string(),
                score: v.number(),
            }),
        ),
        finalAnswer: v.string(),
        selectedAgent: v.optional(v.string()),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        responses: Array<{ agent: string; response: string; score: number }>;
        finalAnswer: string;
        selectedAgent?: string;
    }> => {
        const mode = args.mode ?? "best";
        console.log(`Starting council deliberation in "${mode}" mode`);

        // Step 1: Fan out - Have each council member respond in parallel
        const councilMembers = [
            { name: "Analyst", action: internal.workflows.council_of_agents.analystRespond },
            { name: "Creative", action: internal.workflows.council_of_agents.creativeRespond },
            { name: "Pragmatist", action: internal.workflows.council_of_agents.pragmatistRespond },
        ];

        // Create prompts and run all agents in parallel
        const memberPromises = councilMembers.map(async (member) => {
            const promptMsg = await saveMessage(ctx, components.agent, {
                threadId: args.threadId,
                prompt: `Problem: ${args.problem}\n\nProvide your perspective and solution.`,
            });

            const result = await ctx.runAction(
                member.action,
                {
                    promptMessageId: promptMsg.messageId,
                    threadId: args.threadId,
                },
                { retry: true },
            );

            return {
                agent: member.name,
                response: result.text,
            };
        });

        const memberResponses = await Promise.all(memberPromises);
        console.log(`Received ${memberResponses.length} council responses`);

        // Step 2: Score each response in parallel
        const scorePromises = memberResponses.map(async (response) => {
            const scorePrompt = await saveMessage(ctx, components.agent, {
                threadId: args.threadId,
                prompt: `Rate this solution to "${args.problem}" from 1-10:

Response from ${response.agent}:
${response.response}`,
            });

            const { object: scoring } = await ctx.runAction(
                internal.workflows.council_of_agents.scoreResponse,
                {
                    promptMessageId: scorePrompt.messageId,
                    threadId: args.threadId,
                },
                { retry: true },
            );

            return {
                ...response,
                score: scoring.score,
            };
        });

        const scoredResponses = await Promise.all(scorePromises);

        // Sort by score descending
        scoredResponses.sort((a, b) => b.score - a.score);
        console.log("Scores:", scoredResponses.map((r) => `${r.agent}: ${r.score}`));

        // Step 3: Select best or synthesize
        let finalAnswer: string;
        let selectedAgent: string | undefined;

        if (mode === "best") {
            // Simply pick the highest scored response
            finalAnswer = scoredResponses[0].response;
            selectedAgent = scoredResponses[0].agent;
            console.log(`Selected best response from: ${selectedAgent}`);
        } else {
            // Synthesize a final answer combining insights from all
            const synthesisPrompt = await saveMessage(ctx, components.agent, {
                threadId: args.threadId,
                prompt: `Synthesize the best parts of these council responses into one comprehensive answer:

${scoredResponses.map((r) => `## ${r.agent} (Score: ${r.score}/10)\n${r.response}`).join("\n\n")}

Create a unified response that combines the strongest elements of each perspective.`,
            });

            const synthesis = await ctx.runAction(
                internal.workflows.council_of_agents.synthesizeResponses,
                {
                    promptMessageId: synthesisPrompt.messageId,
                    threadId: args.threadId,
                },
                { retry: true },
            );

            finalAnswer = synthesis.text;
            console.log("Synthesized final answer from all perspectives");
        }

        return {
            responses: scoredResponses,
            finalAnswer,
            selectedAgent,
        };
    },
});

// Agent actions
export const analystRespond = analystAgent.asTextAction({
    stopWhen: stepCountIs(3),
});

export const creativeRespond = creativeAgent.asTextAction({
    stopWhen: stepCountIs(3),
});

export const pragmatistRespond = pragmatistAgent.asTextAction({
    stopWhen: stepCountIs(3),
});

export const scoreResponse = judgeAgent.asObjectAction({
    schema: z.object({
        score: z.number().min(1).max(10),
        reasoning: z.string(),
    }),
});

export const synthesizeResponses = synthesisAgent.asTextAction({
    stopWhen: stepCountIs(3),
});

// Mutation to start the council workflow
export const startCouncil = mutation({
    args: {
        problem: v.string(),
        mode: v.optional(v.union(v.literal("best"), v.literal("synthesize"))),
    },
    handler: async (
        ctx,
        args,
    ): Promise<{ threadId: string; workflowId: string }> => {
        const userId = await getAuthUserId(ctx);
        const threadId = await createThread(ctx, components.agent, {
            userId,
            title: `Council: ${args.problem.slice(0, 50)}`,
        });
        const workflowId = await workflow.start(
            ctx,
            internal.workflows.council_of_agents.councilWorkflow,
            { problem: args.problem, threadId, mode: args.mode },
        );
        return { threadId, workflowId };
    },
});
