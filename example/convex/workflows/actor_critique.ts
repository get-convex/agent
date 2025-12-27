// See the docs at https://docs.convex.dev/agents/workflows
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { internalMutation, mutation } from "../_generated/server";
import { v } from "convex/values";
import { Agent, createThread, saveMessage, stepCountIs } from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { defaultConfig } from "convex/agents/config";
import { z } from "zod/v4";

/**
 * Actor-Critique Pattern: LLM as a judge / self-improvement loop
 *
 * This workflow demonstrates iterative refinement where:
 * 1. An "actor" agent produces output
 * 2. A "critic" agent evaluates and scores the output
 * 3. If score < threshold (and iterations < max), feed critique back to actor
 * 4. Repeat until quality threshold is met or max iterations reached
 */

const workflow = new WorkflowManager(components.workflow);

export const actorCritiqueWorkflow = workflow.define({
    args: {
        task: v.string(),
        threadId: v.string(),
        targetScore: v.optional(v.number()), // 0-10, defaults to 7
        maxIterations: v.optional(v.number()), // defaults to 3
    },
    returns: v.object({
        iterations: v.number(),
        finalScore: v.number(),
        output: v.string(),
        critiqueSummary: v.string(),
    }),
    handler: async (
        ctx,
        args,
    ): Promise<{
        iterations: number;
        finalScore: number;
        output: string;
        critiqueSummary: string;
    }> => {
        const targetScore = args.targetScore ?? 7;
        const maxIterations = args.maxIterations ?? 3;

        console.log(
            `Starting actor-critique loop: target=${targetScore}, maxIter=${maxIterations}`,
        );

        let iteration = 0;
        let currentOutput = "";
        let currentScore = 0;
        let critiqueSummary = "";

        // Create a separate thread for critiques
        const critiqueThreadId = await ctx.runMutation(
            internal.workflows.actor_critique.createCritiqueThread,
            { parentThreadId: args.threadId, task: args.task },
        );
        console.log(`Created critique thread: ${critiqueThreadId}`);

        // Initial prompt to actor (main thread)
        let actorPromptMsg = await saveMessage(ctx, components.agent, {
            threadId: args.threadId,
            prompt: `Task: ${args.task}\n\nPlease complete this task to the best of your ability.`,
        });

        while (iteration < maxIterations) {
            iteration++;
            console.log(`Iteration ${iteration}/${maxIterations}`);

            // Step 1: Actor generates output (main thread)
            const actorResult = await ctx.runAction(
                internal.workflows.actor_critique.actorGenerate,
                {
                    promptMessageId: actorPromptMsg.messageId,
                    threadId: args.threadId,
                },
                { retry: true },
            );
            currentOutput = actorResult.text;
            console.log(`Actor output (${currentOutput.length} chars)`);

            // Step 2: Critic evaluates the output (critique thread)
            const critiquePromptMsg = await saveMessage(ctx, components.agent, {
                threadId: critiqueThreadId,
                prompt: `Iteration ${iteration}: Evaluate this output for the task "${args.task}":\n\n${currentOutput}`,
            });

            const { object: critique } = await ctx.runAction(
                internal.workflows.actor_critique.criticEvaluate,
                {
                    promptMessageId: critiquePromptMsg.messageId,
                    threadId: critiqueThreadId,
                },
                { retry: true },
            );

            currentScore = critique.score;
            critiqueSummary = critique.feedback;
            console.log(`Critic score: ${currentScore}/10`);

            // Step 3: Check if we've met the threshold
            if (currentScore >= targetScore) {
                console.log(`Target score ${targetScore} achieved!`);
                break;
            }

            // Step 4: If not at max iterations, feed critique back to actor (main thread)
            if (iteration < maxIterations) {
                console.log("Feeding critique back to actor for improvement");
                actorPromptMsg = await saveMessage(ctx, components.agent, {
                    threadId: args.threadId,
                    prompt: `Your previous attempt scored ${currentScore}/10.

Feedback: ${critique.feedback}

Specific improvements needed:
${critique.improvements.map((imp: string, i: number) => `${i + 1}. ${imp}`).join("\n")}

Please revise your response addressing this feedback.`,
                });
            }
        }

        return {
            iterations: iteration,
            finalScore: currentScore,
            output: currentOutput,
            critiqueSummary,
        };
    },
});

// Actor agent - produces the output
const actorAgent = new Agent(components.agent, {
    name: "Actor Agent",
    ...defaultConfig,
    instructions: `You are a skilled writer/producer. Complete tasks thoroughly and thoughtfully.
When receiving feedback, carefully address each point while maintaining the strengths of your work.`,
});

export const actorGenerate = actorAgent.asTextAction({
    stopWhen: stepCountIs(3),
});

// Critic agent - evaluates and provides feedback
const criticAgent = new Agent(components.agent, {
    name: "Critic Agent",
    ...defaultConfig,
    instructions: `You are a constructive critic. Evaluate outputs fairly and provide:
1. A score from 0-10 (be honest but fair)
2. Specific, actionable feedback
3. Concrete improvements the author should make

Be constructive, not harsh. Focus on how to improve, not just what's wrong.`,
});

export const criticEvaluate = criticAgent.asObjectAction({
    schema: z.object({
        score: z.number().min(0).max(10).describe("Quality score from 0-10"),
        feedback: z.string().describe("Overall feedback summary"),
        improvements: z
            .array(z.string())
            .describe("List of specific improvements to make"),
        strengths: z.array(z.string()).describe("What was done well"),
    }),
});

// Internal mutation to create a separate thread for critiques
export const createCritiqueThread = internalMutation({
    args: {
        parentThreadId: v.string(),
        task: v.string(),
    },
    returns: v.string(),
    handler: async (ctx, args) => {
        const threadId = await createThread(ctx, components.agent, {
            title: `Critique Thread: ${args.task.slice(0, 40)}`,
        });
        return threadId;
    },
});

// Mutation to start the actor-critique workflow
export const startActorCritique = mutation({
    args: {
        task: v.string(),
        targetScore: v.optional(v.number()),
        maxIterations: v.optional(v.number()),
    },
    handler: async (
        ctx,
        args,
    ): Promise<{ threadId: string; workflowId: string }> => {
        const userId = await getAuthUserId(ctx);
        const threadId = await createThread(ctx, components.agent, {
            userId,
            title: `Actor-Critique: ${args.task.slice(0, 50)}`,
        });
        const workflowId = await workflow.start(
            ctx,
            internal.workflows.actor_critique.actorCritiqueWorkflow,
            {
                task: args.task,
                threadId,
                targetScore: args.targetScore,
                maxIterations: args.maxIterations,
            },
        );
        return { threadId, workflowId };
    },
});

