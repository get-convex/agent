// See the docs at https://docs.convex.dev/agents/human-agents
import {
  WorkflowManager,
  defineEvent,
  vWorkflowId,
} from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  mutation,
} from "../_generated/server";
import { v } from "convex/values";
import { createThread, saveMessage, stepCountIs } from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { agent as simpleAgent } from "../agents/simple";
import { tool } from "ai";
import { z } from "zod/v3";

/**
 * Human-in-the-Loop Pattern: Pause generation for human input
 *
 * This demonstrates doing generation until a human's input is required, which
 * is accomplished via:
 * 1. A tool call with no execute handler
 * 2. Creating an event for the parent workflow to wait on with ctx.awaitEvent
 * 3. A human providing the response which sends the event
 */

const workflow = new WorkflowManager(components.workflow);

// Define an event for human approval
export const humanInputEvent = defineEvent({
  name: "humanInput" as const,
  validator: v.object({
    response: v.string(),
    toolCallId: v.string(),
  }),
});

// Tool without execute handler - this will pause execution
export const askForApproval = tool({
  description:
    "Request approval from a human before proceeding with a sensitive action",
  inputSchema: z.object({
    action: z
      .string()
      .describe("The action that needs approval (e.g., 'delete data')"),
    reason: z.string().describe("Why this action is necessary"),
  }),
});

export const humanInTheLoopWorkflow = workflow.define({
  args: { task: v.string(), threadId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    console.log("Starting human-in-the-loop workflow for task:", args.task);

    // Step 1: Do initial generation with the tool available
    const initialMsg = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: args.task,
    });

    const initialResult = await ctx.runAction(
      internal.workflows.human_in_the_loop.generateWithApprovalTool,
      {
        promptMessageId: initialMsg.messageId,
        threadId: args.threadId,
        workflowId: ctx.workflowId,
      },
      { retry: true },
    );

    console.log("Initial generation result:", initialResult);

    // Step 2: Check if human approval was requested
    if (initialResult.approvalRequests.length > 0) {
      console.log(
        "Human approval required:",
        initialResult.approvalRequests.length,
        "requests",
      );

      // Wait for each approval request
      for (const request of initialResult.approvalRequests) {
        console.log("Waiting for approval:", request);

        // Wait for the human to respond via the event
        const humanInput = await ctx.awaitEvent(humanInputEvent);

        console.log("Human response received:", humanInput);

        // Save the human's response as a tool result
        await simpleAgent.saveMessage(ctx, {
          threadId: args.threadId,
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                output: { type: "text", value: humanInput.response },
                toolCallId: humanInput.toolCallId,
                toolName: "askForApproval",
              },
            ],
          },
          metadata: {
            provider: "human",
            providerMetadata: {
              human: { role: "approver" },
            },
          },
        });
      }

      // Step 3: Continue generation with the human's responses
      const finalResult = await ctx.runAction(
        internal.workflows.human_in_the_loop.continueGeneration,
        {
          promptMessageId: initialResult.promptMessageId!,
          threadId: args.threadId,
        },
        { retry: true },
      );

      return finalResult.text;
    } else {
      // No approval needed, return the initial response
      return initialResult.text;
    }
  },
});

// Generate text with approval tool available
export const generateWithApprovalTool = internalAction({
  args: {
    promptMessageId: v.string(),
    threadId: v.string(),
    workflowId: vWorkflowId,
  },
  handler: async (ctx, args) => {
    const result = await simpleAgent.generateText(
      ctx,
      { threadId: args.threadId },
      {
        promptMessageId: args.promptMessageId,
        tools: { askForApproval },
        prompt: `You are a helpful assistant. If the task involves sensitive actions like deleting data, modifying important settings, or making irreversible changes, you MUST use the askForApproval tool to get human approval before proceeding. Be specific about what action you're requesting approval for.`,
        stopWhen: stepCountIs(3),
      },
    );

    // Extract approval requests from tool calls
    const approvalRequests = result.toolCalls
      .filter((tc) => tc.toolName === "askForApproval" && !tc.dynamic)
      .map(({ toolCallId, input }) => ({
        toolCallId,
        action: input.action,
        reason: input.reason,
      }));

    // If there are approval requests, create events for each
    if (approvalRequests.length > 0) {
      await ctx.runMutation(
        internal.workflows.human_in_the_loop.notifyHumanApproval,
        {
          workflowId: args.workflowId,
          threadId: args.threadId,
          approvalRequests,
        },
      );
    }

    return {
      text: result.text,
      promptMessageId: result.promptMessageId,
      approvalRequests,
    };
  },
});

// Notify that human approval is needed (could send email, notification, etc.)
export const notifyHumanApproval = internalMutation({
  args: {
    workflowId: vWorkflowId,
    threadId: v.string(),
    approvalRequests: v.array(
      v.object({
        toolCallId: v.string(),
        action: v.string(),
        reason: v.string(),
      }),
    ),
  },
  handler: async (_ctx, args) => {
    // In a real app, this would:
    // - Send notifications to appropriate humans
    // - Store pending approvals in a table
    // - Create UI for humans to respond
    console.log("Human approval needed for workflow:", args.workflowId);
    console.log("Approval requests:", args.approvalRequests);
    console.log(
      "Call humanResponse mutation with workflowId and responses to proceed",
    );
  },
});

// Continue generation after human input
export const continueGeneration = simpleAgent.asTextAction({
  stopWhen: stepCountIs(2),
});

// Public mutation for humans to provide their response
export const humanResponse = mutation({
  args: {
    workflowId: vWorkflowId,
    toolCallId: v.string(),
    approved: v.boolean(),
    comments: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const response = args.approved
      ? `Approved: ${args.comments ?? "You may proceed with this action."}`
      : `Rejected: ${args.comments ?? "This action is not authorized."}`;

    await workflow.sendEvent(ctx, {
      ...humanInputEvent,
      workflowId: args.workflowId,
      value: {
        response,
        toolCallId: args.toolCallId,
      },
    });
  },
});

// Mutation to start the human-in-the-loop workflow
export const startHumanInTheLoop = mutation({
  args: { task: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; workflowId: string }> => {
    const userId = await getAuthUserId(ctx);
    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: `Human-in-Loop: ${args.task.slice(0, 50)}`,
    });
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.human_in_the_loop.humanInTheLoopWorkflow,
      { task: args.task, threadId },
    );
    return { threadId, workflowId };
  },
});
