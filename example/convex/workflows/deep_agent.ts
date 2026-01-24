// See the docs at https://docs.convex.dev/agents/workflows
import { WorkflowId, WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery, mutation } from "../_generated/server";
import { v } from "convex/values";
import {
    Agent,
    createThread,
    createTool,
    saveMessage,
    stepCountIs,
} from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { defaultConfig } from "convex/agents/config";
import { z } from "zod/v4";
import { TypedToolCall } from "ai";

/**
 * Deep Agent Pattern: One-Turn-Per-Action Workflow with Completion Injection.
 * 
 * This pattern demonstrates:
 * 1. Strict one-turn turns to stay within 10m limit.
 * 2. Parallel sub-agent delegation orchestrated by the workflow.
 * 3. Completion injection (Assistant tool-call -> Tool result) for structured feedback.
 */

const workflow = new WorkflowManager(components.workflow);

// =============================================================================
// TOOLS
// =============================================================================

const internetSearch = createTool({
    description: "Run a web search to find information on the internet",
    args: z.object({
        query: z.string().describe("The search query"),
    }),
    handler: async (_ctx, args) => {
        console.log(`Searching for: ${args.query}`);
        return `Search results for "${args.query}":\n1. [Mock Result] Relevant information about ${args.query}...`;
    },
});

const updateScratchpad = createTool({
    description: "Update the scratchpad with your current plan, findings, or final report.",
    args: z.object({
        content: z.string().describe("The new content for the scratchpad"),
    }),
    handler: async (ctx, args) => {
        await ctx.runMutation(internal.workflows.deep_agent.setScratchpad, {
            threadId: (ctx as any).threadId,
            content: args.content,
        });
        return "Scratchpad updated.";
    },
});

const readScratchpad = createTool({
    description: "Read the current contents of the scratchpad.",
    args: z.object({}),
    handler: async (ctx): Promise<string> => {
        const content: string | null = await ctx.runQuery(internal.workflows.deep_agent.getScratchpad, {
            threadId: (ctx as any).threadId,
        });
        return content ?? "Scratchpad is empty.";
    },
});

const delegateToSubagent = createTool({
    description: "Request help from a sub-agent for a specific task. Results will be injected later.",
    args: z.object({
        taskTitle: z.string().describe("Short title for the task"),
        taskPrompt: z.string().describe("Detailed instructions for the sub-agent"),
    }),
    handler: async (_ctx, args) => {
        return JSON.stringify({
            status: "DELEGATION_STARTED",
            title: args.taskTitle,
            prompt: args.taskPrompt,
        });
    },
});

const subagentCompletion = createTool({
    description: "Internal tool used to inject sub-agent results. Do not call this yourself.",
    args: z.object({
        results: z.array(z.object({
            title: z.string(),
            output: z.string(),
        })),
    }),
    handler: async (_ctx, args) => {
        return `Received results for ${args.results.length} sub-agent(s).`;
    },
});

const toolset = {
    internetSearch,
    updateScratchpad,
    readScratchpad,
    delegateToSubagent,
    subagentCompletion,
}



// =============================================================================
// AGENT DEFINITIONS
// =============================================================================

const deepAgent = new Agent(components.agent, {
    name: "Deep Agent",
    ...defaultConfig,
    instructions: `You are a research agent.
1. Use the scratchpad to track your progress and findings.
2. Conduct research using internetSearch.
3. Delegate complex or long sub-tasks using delegateToSubagent (can use multiple in parallel).
4. Results from sub-agents will be provided to you via the subagentCompletion tool.
5. When done, write your final report to the scratchpad and stop.`,
    tools: toolset,
});

export const runAgentStep = internalAction({
    args: {
        threadId: v.string(),
        promptMessageId: v.string(),
    },
    handler: async (ctx, args): Promise<{ text: string, toolCalls: TypedToolCall<typeof toolset>[], finishReason: string }> => {
        const { text, toolCalls, finishReason } = await deepAgent.generateText(ctx, { threadId: args.threadId }, {
            promptMessageId: args.promptMessageId,
            stopWhen: [stepCountIs(1)], // Only run one step so we can handle the tool calls as their own actions
        });

        return {
            text,
            toolCalls,
            finishReason,
        };
    },
});

/**
 * Injects sub-agent results as structured tool calls into the thread.
 */
export const injectSubagentResults = internalAction({
    args: {
        threadId: v.string(),
        results: v.array(v.object({
            title: v.string(),
            output: v.string(),
        })),
    },
    handler: async (ctx, args) => {
        const toolCallId = `subagent-results-${Date.now()}`;

        // 1. Assistant message with tool-call
        await deepAgent.saveMessage(ctx, {
            threadId: args.threadId,
            message: {
                role: "assistant",
                content: [
                    {
                        type: "tool-call",
                        toolCallId,
                        toolName: "subagentCompletion",
                        args: { results: args.results },
                    },
                ],
            },
            skipEmbeddings: true,
        });

        // 2. Tool result message
        const { messageId } = await deepAgent.saveMessage(ctx, {
            threadId: args.threadId,
            message: {
                role: "tool",
                content: [
                    {
                        type: "tool-result",
                        toolCallId,
                        toolName: "subagentCompletion",
                        result: JSON.stringify({
                            success: true,
                            message: `Here are the results from your delegated tasks.`,
                            results: args.results,
                        }),
                    },
                ],
            },
            skipEmbeddings: true,
        });

        return messageId;
    },
});

// =============================================================================
// WORKFLOW
// =============================================================================

export const deepAgentWorkflow = workflow.define({
    args: {
        task: v.string(),
        threadId: v.string(),
        maxIterations: v.optional(v.number()),
    },
    returns: v.object({
        iterations: v.number(),
        finalReport: v.string(),
    }),
    handler: async (ctx, args): Promise<{ iterations: number; finalReport: string }> => {
        const maxIterations = args.maxIterations ?? 20;
        let iterations = 0;
        let isComplete = false;
        let promptMessageId: string | undefined;

        const initialMsg = await saveMessage(ctx, components.agent, {
            threadId: args.threadId,
            prompt: `Task: ${args.task}\n\nPlan your research in the scratchpad.`,
        });
        promptMessageId = initialMsg.messageId;

        while (!isComplete && iterations < maxIterations) {
            iterations++;
            console.log(`Deep agent turn ${iterations}`);

            const stepResult = await ctx.runAction(
                internal.workflows.deep_agent.runAgentStep,
                {
                    promptMessageId: promptMessageId!,
                    threadId: args.threadId,
                }
            );

            // 1. Handle Parallel Delegations
            const delegationCalls = (stepResult.toolCalls || []).filter((tc: any) => tc.toolName === "delegateToSubagent");
            if (delegationCalls.length > 0) {
                console.log(`[Workflow] Orchestrating ${delegationCalls.length} parallel delegation(s)`);

                const results = await Promise.all(
                    delegationCalls.map(async (tc: any) => {
                        const signal = JSON.parse(tc.result as string);
                        const output: string = await ctx.runWorkflow(internal.workflows.deep_agent.subagentWorkflow, {
                            parentThreadId: args.threadId,
                            taskTitle: signal.title,
                            taskPrompt: signal.prompt,
                        });
                        return { title: signal.title, output };
                    })
                );

                // Structured injection of all results at once
                const injectionMessageId: string = await ctx.runAction(internal.workflows.deep_agent.injectSubagentResults, {
                    threadId: args.threadId,
                    results,
                });
                promptMessageId = injectionMessageId;
                continue;
            }

            // 2. Detect Completion
            if (stepResult.finishReason === "stop" && stepResult.toolCalls.length === 0) {
                isComplete = true;
                break;
            }

            // 3. Prompt Continuation
            if (stepResult.finishReason === "stop" || stepResult.finishReason === "tool-calls") {
                const continueMsg = await saveMessage(ctx, components.agent, {
                    threadId: args.threadId,
                    prompt: "Continue with your research until the report in the scratchpad is finished.",
                });
                promptMessageId = continueMsg.messageId;
            }
        }

        const finalReport: string | null = await ctx.runQuery(internal.workflows.deep_agent.getScratchpad, {
            threadId: args.threadId,
        });

        return {
            iterations,
            finalReport: finalReport ?? "No report generated.",
        };
    },
});

// =============================================================================
// SUB-AGENT WORKFLOW
// =============================================================================

export const subagentWorkflow = workflow.define({
    args: { parentThreadId: v.string(), taskTitle: v.string(), taskPrompt: v.string() },
    returns: v.string(),
    handler: async (_ctx, args) => {
        return `Detailed research results for: ${args.taskTitle}`;
    },
});

// =============================================================================
// DATA STORE
// =============================================================================

export const getScratchpad = internalQuery({
    args: { threadId: v.string() },
    returns: v.union(v.string(), v.null()),
    handler: async (_ctx, _args) => {
        return "## Research Report\nResearch in progress...";
    },
});

export const setScratchpad = internalMutation({
    args: { threadId: v.string(), content: v.string() },
    returns: v.null(),
    handler: async (_ctx, _args) => {
        return null;
    },
});

// =============================================================================
// ENTRY POINT
// =============================================================================

export const invoke = mutation({
    args: {
        messages: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
        maxIterations: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const task = args.messages[args.messages.length - 1].content;
        const userId = await getAuthUserId(ctx);
        const threadId = await createThread(ctx, components.agent, { userId, title: `Deep Research: ${task.slice(0, 50)}` });
        const workflowId: WorkflowId = await workflow.start(ctx, internal.workflows.deep_agent.deepAgentWorkflow, { task, threadId, maxIterations: args.maxIterations });
        return { threadId, workflowId };
    },
});
