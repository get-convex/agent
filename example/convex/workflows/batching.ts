// See the docs at https://docs.convex.dev/agents/workflows
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { createThread, saveMessage, stepCountIs, Agent } from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { defaultConfig } from "../agents/config";

/**
 * Advanced Batching Patterns for Deep Research Workflows
 *
 * USE CASE: Deep Research / Multi-Topic Analysis
 * ================================================
 * Imagine you're building a research assistant that needs to:
 * - Analyze 50+ competitors for a market research report
 * - Research 100+ scientific papers for a literature review
 * - Investigate multiple angles of a complex topic (legal, technical, financial)
 * - Generate comprehensive reports across many data points
 *
 * Without batching, you'd either:
 * - Hit rate limits from LLM providers (most allow 50-100 RPM)
 * - Overwhelm system resources trying to run 100+ concurrent requests
 * - Lose all progress if one request fails
 *
 * WHY BATCHING MATTERS:
 * =====================
 * 1. Rate Limit Management: LLM providers (OpenAI, Anthropic, etc.) enforce
 *    rate limits. Batching lets you control throughput (e.g., 5 at a time).
 *
 * 2. Resource Efficiency: Running 100 concurrent LLM calls wastes resources
 *    waiting on I/O. A pool of 5-10 workers is typically optimal.
 *
 * 3. Fault Tolerance: If one research task fails, you don't lose the others.
 *    Sub-workflows provide isolation for independent retries.
 *
 * 4. Progress Tracking: Batching gives natural checkpoints to track progress
 *    and resume from failures.
 *
 * This file demonstrates three patterns:
 * - Batch Pattern: Process in fixed-size chunks (simple, predictable rate)
 * - Pool Pattern: Worker pool pulls from queue (efficient, consistent throughput)
 * - Nested Batch: Sub-workflows for isolation (fault tolerant, resumable)
 */

const workflow = new WorkflowManager(components.workflow);

// Define the researcher agent inline to keep the demo self-contained
const researcherAgent = new Agent(components.agent, {
    name: "Researcher",
    instructions: `You are a thorough researcher. When given a topic:
- Provide key facts and insights
- Summarize the most important information
- Be concise but comprehensive
- Focus on actionable knowledge`,
    stopWhen: stepCountIs(3),
    ...defaultConfig,
});

// ============================================================================
// PATTERN 1: Batch Processing
// ============================================================================
// Process items in fixed-size batches. Each batch runs in parallel,
// but we wait for the entire batch to complete before starting the next.
//
// EXAMPLE USE CASE:
// Research 50 companies for a market analysis. Process 5 at a time to stay
// under your LLM provider's rate limit of 60 requests per minute.
//
// Pros:
// - Simple to understand and implement
// - Predictable rate of API calls (batchSize calls, then pause)
// - Easy to add delays between batches for rate limiting
// - Natural checkpoints for progress tracking
//
// Cons:
// - Inefficient if items have varying processing times
// - Slowest item in batch holds up the entire batch
//
// RATE LIMIT TIP: If you need 60 RPM max, use batchSize=5 and you'll make
// 5 requests per batch. Each batch takes ~10-30 seconds, keeping you safe.
// ============================================================================

export const batchResearchWorkflow = workflow.define({
    args: {
        topics: v.array(v.string()),
        threadId: v.string(),
        batchSize: v.optional(v.number()), // Default: 5
    },
    returns: v.array(
        v.object({
            topic: v.string(),
            research: v.string(),
        }),
    ),
    handler: async (
        ctx,
        args,
    ): Promise<Array<{ topic: string; research: string }>> => {
        const batchSize = args.batchSize ?? 5;
        const results: Array<{ topic: string; research: string }> = [];

        console.log(
            `Starting batch research: ${args.topics.length} topics, batch size ${batchSize}`,
        );

        // Process topics in batches
        for (let i = 0; i < args.topics.length; i += batchSize) {
            const batch = args.topics.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(args.topics.length / batchSize);

            console.log(`Processing batch ${batchNumber}/${totalBatches}: ${batch.join(", ")}`);

            // Run all items in this batch in parallel
            const batchPromises = batch.map(async (topic) => {
                const promptMsg = await saveMessage(ctx, components.agent, {
                    threadId: args.threadId,
                    prompt: `Research the following topic and provide key insights: ${topic}`,
                });

                const result = await ctx.runAction(
                    internal.workflows.batching.researchTopic,
                    {
                        promptMessageId: promptMsg.messageId,
                        threadId: args.threadId,
                    },
                    { retry: true },
                );

                return { topic, research: result.text };
            });

            // Wait for entire batch to complete before starting next
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            console.log(`Batch ${batchNumber} complete`);

            // Optional: Add delay between batches to respect rate limits
            // The workflow system handles this gracefully - you could also
            // use ctx.runMutation to schedule a delay if needed
        }

        console.log(`Batch research complete: ${results.length} topics researched`);
        return results;
    },
});

// ============================================================================
// PATTERN 2: Worker Pool
// ============================================================================
// Maintain a fixed pool of concurrent "workers". As soon as one worker
// finishes, it immediately picks up the next item from the queue.
//
// EXAMPLE USE CASE:
// Research 100 scientific papers where some are short abstracts (fast) and
// some are full papers (slow). A pool keeps all workers busy - when one
// finishes a quick abstract, it immediately grabs the next paper.
//
// Pros:
// - More efficient utilization (no waiting for slowest item in batch)
// - Consistent concurrency level (always N requests in flight)
// - Better throughput for items with varying processing times
// - Maximizes throughput within rate limits
//
// Cons:
// - More complex implementation
// - Harder to reason about ordering (results come back out of order)
// - Less predictable checkpoints
//
// RATE LIMIT TIP: Set poolSize to match your desired concurrent requests.
// If your rate limit is 100 RPM and each request takes ~30s, poolSize=50
// keeps you at ~100 requests per minute.
// ============================================================================

export const poolResearchWorkflow = workflow.define({
    args: {
        topics: v.array(v.string()),
        threadId: v.string(),
        poolSize: v.optional(v.number()), // Default: 5
    },
    returns: v.array(
        v.object({
            topic: v.string(),
            research: v.string(),
        }),
    ),
    handler: async (
        ctx,
        args,
    ): Promise<Array<{ topic: string; research: string }>> => {
        const poolSize = args.poolSize ?? 5;
        const results: Array<{ topic: string; research: string }> = [];

        // In a production app, you would define a 'jobs' table in your schema.
        // This workflow would then fetch from that table to manage state across
        // potential restarts or large volume research tasks.
        //
        // Example Table Schema:
        // research_jobs: { batchId: string, topic: string, status: "pending" | "done" }

        // For this demo, we'll use an in-memory queue to simulate the pooling.
        const queue = [...args.topics];
        let nextIndex = 0;

        console.log(
            `Starting pool research: ${args.topics.length} topics, pool size ${poolSize}`,
        );

        /**
         * PRODUCTION TIP: Instead of an in-memory queue, you'd use a function like:
         * const getNextJob = async () => {
         *   // Atomically claim the next 'pending' job for this research session
         *   return await ctx.runMutation(internal.research.claimNextJob, { batchId });
         * };
         * 
         * The loop would then be:
         * while (await hasPendingJobs(batchId)) { ... }
         */
        const getNextJob = () => {
            if (nextIndex >= queue.length) return null;
            return queue[nextIndex++];
        };

        // Helper to process a single topic
        const processTopic = async (topic: string): Promise<{ topic: string; research: string }> => {
            const promptMsg = await saveMessage(ctx, components.agent, {
                threadId: args.threadId,
                prompt: `Research the following topic and provide key insights: ${topic}`,
            });

            const result = await ctx.runAction(
                internal.workflows.batching.researchTopic,
                {
                    promptMessageId: promptMsg.messageId,
                    threadId: args.threadId,
                },
                { retry: true },
            );

            return { topic, research: result.text };
        };

        // Worker function: pulls from the "pending requests" until none remain.
        const worker = async (): Promise<void> => {
            // "While pending requests for this session exist..."
            while (true) {
                const topic = getNextJob();
                if (!topic) {
                    break; // No more pending requests
                }

                console.log(`Worker processing topic: ${topic}`);
                const result = await processTopic(topic);
                results.push(result);
            }
        };

        // Start pool of workers
        const workers: Array<Promise<void>> = [];
        const actualPoolSize = Math.min(poolSize, queue.length);

        for (let i = 0; i < actualPoolSize; i++) {
            workers.push(worker());
        }

        // Wait for all workers in the pool to complete their queues
        await Promise.all(workers);

        console.log(`Pool research complete: ${results.length} topics researched`);

        // Note: Results may be out of order since workers complete at different times
        // Sort by original order if needed
        const topicOrder = new Map(args.topics.map((t, i) => [t, i]));
        results.sort((a, b) => (topicOrder.get(a.topic) ?? 0) - (topicOrder.get(b.topic) ?? 0));

        return results;
    },
});

// ============================================================================
// Sub-workflow for individual topic research
// ============================================================================
// Breaking out individual research into a sub-workflow allows:
// - Better error isolation (one failure doesn't affect others)
// - Cleaner retry logic (Convex handles retries per workflow)
// - Easier testing (can test single topic research independently)
// - Resumability (failed workflows can be retried without re-running successes)
//
// EXAMPLE: If researching 100 topics and topic #47 fails due to a transient
// error, only that sub-workflow needs to retry - the other 99 are unaffected.
// ============================================================================

export const topicResearchSubWorkflow = workflow.define({
    args: {
        topic: v.string(),
        threadId: v.string(),
    },
    returns: v.string(),
    handler: async (ctx, args): Promise<string> => {
        const promptMsg = await saveMessage(ctx, components.agent, {
            threadId: args.threadId,
            prompt: `Research the following topic thoroughly: ${args.topic}

Provide:
1. Key facts and background
2. Current state/trends
3. Important considerations
4. Actionable insights`,
        });

        const result = await ctx.runAction(
            internal.workflows.batching.researchTopic,
            {
                promptMessageId: promptMsg.messageId,
                threadId: args.threadId,
            },
            { retry: true },
        );

        return result.text;
    },
});

// ============================================================================
// PATTERN 3: Nested Batch with Sub-workflows (Recommended for Production)
// ============================================================================
// For very large workloads, use nested workflows for better isolation.
// Each item is its own workflow, allowing independent retries and state.
//
// EXAMPLE USE CASE:
// Deep research on 200 topics for a comprehensive report. Each topic is a
// separate sub-workflow, so if 3 fail due to rate limits or timeouts, you
// can retry just those 3 without re-running the successful 197.
//
// This is the RECOMMENDED pattern for production deep research because:
// - Each research task has independent state and retry logic
// - Partial failures don't lose completed work
// - You can monitor progress per-topic in the Convex dashboard
// - Easy to add more sophisticated per-topic logic (multi-step research, etc.)
// ============================================================================

export const nestedBatchResearchWorkflow = workflow.define({
    args: {
        topics: v.array(v.string()),
        threadId: v.string(),
        batchSize: v.optional(v.number()),
    },
    returns: v.array(
        v.object({
            topic: v.string(),
            research: v.string(),
        }),
    ),
    handler: async (
        ctx,
        args,
    ): Promise<Array<{ topic: string; research: string }>> => {
        const batchSize = args.batchSize ?? 5;
        const results: Array<{ topic: string; research: string }> = [];

        console.log(
            `Starting nested batch research: ${args.topics.length} topics, batch size ${batchSize}`,
        );

        for (let i = 0; i < args.topics.length; i += batchSize) {
            const batch = args.topics.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(args.topics.length / batchSize);

            console.log(`Processing batch ${batchNumber}/${totalBatches}`);

            // Each topic gets its own sub-workflow for better isolation
            const batchPromises = batch.map(async (topic) => {
                const research = await ctx.runWorkflow(
                    internal.workflows.batching.topicResearchSubWorkflow,
                    { topic, threadId: args.threadId },
                );
                return { topic, research };
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            console.log(`Batch ${batchNumber} complete`);
        }

        return results;
    },
});

// Agent action
export const researchTopic = researcherAgent.asTextAction({
    stopWhen: stepCountIs(3),
});

// ============================================================================
// Entry point mutations
// ============================================================================
// Choose your pattern based on your needs:
//
// startBatchResearch    → Simple, predictable. Good for small-medium workloads
//                         where you want easy-to-understand rate limiting.
//
// startPoolResearch     → Efficient, fast. Good when items have varying
//                         processing times and you want max throughput.
//
// startNestedBatchResearch → Robust, production-ready. Good for large workloads
//                            where fault tolerance and resumability matter.
// ============================================================================

export const startBatchResearch = mutation({
    args: {
        topics: v.array(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (
        ctx,
        args,
    ): Promise<{ threadId: string; workflowId: string }> => {
        const userId = await getAuthUserId(ctx);
        const threadId = await createThread(ctx, components.agent, {
            userId,
            title: `Batch Research: ${args.topics.length} topics`,
        });
        const workflowId = await workflow.start(
            ctx,
            internal.workflows.batching.batchResearchWorkflow,
            { topics: args.topics, threadId, batchSize: args.batchSize },
        );
        return { threadId, workflowId };
    },
});

export const startPoolResearch = mutation({
    args: {
        topics: v.array(v.string()),
        poolSize: v.optional(v.number()),
    },
    handler: async (
        ctx,
        args,
    ): Promise<{ threadId: string; workflowId: string }> => {
        const userId = await getAuthUserId(ctx);
        const threadId = await createThread(ctx, components.agent, {
            userId,
            title: `Pool Research: ${args.topics.length} topics`,
        });
        const workflowId = await workflow.start(
            ctx,
            internal.workflows.batching.poolResearchWorkflow,
            { topics: args.topics, threadId, poolSize: args.poolSize },
        );
        return { threadId, workflowId };
    },
});

export const startNestedBatchResearch = mutation({
    args: {
        topics: v.array(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (
        ctx,
        args,
    ): Promise<{ threadId: string; workflowId: string }> => {
        const userId = await getAuthUserId(ctx);
        const threadId = await createThread(ctx, components.agent, {
            userId,
            title: `Nested Batch Research: ${args.topics.length} topics`,
        });
        const workflowId = await workflow.start(
            ctx,
            internal.workflows.batching.nestedBatchResearchWorkflow,
            { topics: args.topics, threadId, batchSize: args.batchSize },
        );
        return { threadId, workflowId };
    },
});

