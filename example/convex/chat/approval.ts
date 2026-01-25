// Tool Approval Demo - Convex Functions
// Demonstrates the AI SDK v6 two-call model for tool approval
import { paginationOptsValidator } from "convex/server";
import {
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import {
  internalAction,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { authorizeThreadAccess } from "../threads";
import { approvalAgent } from "../agents/approval";

/**
 * Send a message and start generation.
 * If the agent uses a tool that requires approval, it will pause and
 * return a tool-approval-request in the response.
 */
export const sendMessage = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);

    // Save the user's message
    const { messageId } = await approvalAgent.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    });

    // Start async generation
    await ctx.scheduler.runAfter(0, internal.chat.approval.generateResponse, {
      threadId,
      promptMessageId: messageId,
    });

    return { messageId };
  },
});

/**
 * Internal action that generates the response.
 * This will stop if a tool requires approval.
 */
export const generateResponse = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const result = await approvalAgent.streamText(
      ctx,
      { threadId },
      {
        promptMessageId,
        onStepFinish: (step) => {
          console.log("Step finished:", {
            finishReason: step.finishReason,
            toolCallsCount: step.toolCalls.length,
            toolResultsCount: step.toolResults.length,
            contentTypes: step.content.map((c) => c.type),
            responseMessagesCount: step.response.messages.length,
            responseMessages: step.response.messages.map((m) => ({
              role: m.role,
              contentTypes: Array.isArray(m.content)
                ? m.content.map((c: { type: string }) => c.type)
                : typeof m.content,
            })),
          });
        },
      },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});

/**
 * Submit an approval response for a pending tool call.
 * After approval, executes the tool and continues the generation.
 */
export const submitApproval = mutation({
  args: {
    threadId: v.string(),
    approvalId: v.string(),
    approved: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, approvalId, approved, reason }) => {
    await authorizeThreadAccess(ctx, threadId);

    // Find the assistant message that contains the tool-approval-request with this approvalId
    // We need this to set the correct promptMessageId so the approval response
    // is grouped with the tool call during UIMessage construction
    const messagesResult = await approvalAgent.listMessages(ctx, {
      threadId,
      paginationOpts: { numItems: 20, cursor: null },
    });

    let parentMessageId: string | undefined;
    let toolCallId: string | undefined;
    let toolName: string | undefined;

    // First pass: find the tool-approval-request to get toolCallId and parent message
    // This must be a separate pass because tool-call comes BEFORE tool-approval-request
    // in the content array, so toolCallId isn't set yet when we first see tool-call
    for (const msg of messagesResult.page) {
      if (msg.message?.role === "assistant" && Array.isArray(msg.message.content)) {
        for (const part of msg.message.content) {
          if (part.type === "tool-approval-request" && part.approvalId === approvalId) {
            parentMessageId = msg._id;
            toolCallId = part.toolCallId;
            break;
          }
        }
      }
      if (toolCallId) break;
    }

    // Second pass: find the tool-call with matching toolCallId to get toolName
    if (toolCallId) {
      for (const msg of messagesResult.page) {
        if (msg.message?.role === "assistant" && Array.isArray(msg.message.content)) {
          for (const part of msg.message.content) {
            if (part.type === "tool-call" && part.toolCallId === toolCallId) {
              toolName = part.toolName;
              break;
            }
          }
        }
        if (toolName) break;
      }
    }

    // Save the approval response - this updates the UI to show approval/denial status
    // The tool-approval-response is processed by listUIMessages to update tool part state
    // By setting promptMessageId, it will have the same order as the assistant message
    await approvalAgent.saveMessage(ctx, {
      threadId,
      promptMessageId: parentMessageId,
      message: {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId,
            approved,
            reason: reason,
          },
        ],
      },
      skipEmbeddings: true,
    });

    if (approved) {
      // Schedule the action to execute the approved tool and continue
      await ctx.scheduler.runAfter(0, internal.chat.approval.executeApprovedTool, {
        threadId,
        approvalId,
      });
    } else if (toolCallId && toolName) {
      // For denial, save a tool-result with execution-denied output.
      // This is required by Anthropic's API which expects every tool_use to have
      // a corresponding tool_result in the next message.
      // Group with original message using promptMessageId.
      const { messageId: toolResultId } = await approvalAgent.saveMessage(ctx, {
        threadId,
        promptMessageId: parentMessageId,
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId,
              toolName,
              output: {
                type: "execution-denied",
                reason: reason ?? "Tool execution was denied by the user",
              },
            },
          ],
        },
        skipEmbeddings: true,
      });

      // Continue generation so the LLM can respond to the denial
      // Use forceNewOrder to create a separate message from the original tool call.
      await ctx.scheduler.runAfter(0, internal.chat.approval.continueGeneration, {
        threadId,
        promptMessageId: toolResultId,
        forceNewOrder: true,
      });
    }

    return { approved };
  },
});

/**
 * Execute an approved tool and continue generation.
 * This action finds the pending tool call, executes it, saves the result,
 * and then continues the generation.
 */
export const executeApprovedTool = internalAction({
  args: { threadId: v.string(), approvalId: v.string() },
  handler: async (ctx, { threadId, approvalId }) => {
    // Get recent messages to find the pending tool call
    const messagesResult = await approvalAgent.listMessages(ctx, {
      threadId,
      paginationOpts: { numItems: 20, cursor: null },
    });

    // Find the tool-approval-request and tool-call with this approvalId
    let toolCallId: string | undefined;
    let toolName: string | undefined;
    let toolInput: Record<string, unknown> | undefined;
    let parentMessageId: string | undefined;

    // First pass: find the toolCallId and parent message from the approval request
    for (const msg of messagesResult.page) {
      if (msg.message?.role === "assistant" && Array.isArray(msg.message.content)) {
        for (const part of msg.message.content) {
          if (part.type === "tool-approval-request" && part.approvalId === approvalId) {
            toolCallId = part.toolCallId;
            parentMessageId = msg._id;
            break;
          }
        }
      }
      if (toolCallId) break;
    }

    // Second pass: find the tool-call with matching toolCallId
    if (toolCallId) {
      for (const msg of messagesResult.page) {
        if (msg.message?.role === "assistant" && Array.isArray(msg.message.content)) {
          for (const part of msg.message.content) {
            if (part.type === "tool-call" && part.toolCallId === toolCallId) {
              toolName = part.toolName;
              toolInput = part.input ?? (part as Record<string, unknown>).args ?? {};
              break;
            }
          }
        }
        if (toolName) break;
      }
    }

    if (!toolCallId || !toolName || !toolInput) {
      console.error("Could not find tool call for approval", { approvalId, toolCallId, toolName });
      return;
    }

    // Get the tool and wrap it with context
    const tools = approvalAgent.options.tools as Record<string, any> | undefined;
    const tool = tools?.[toolName];
    if (!tool) {
      console.error("Tool not found", { toolName });
      return;
    }

    // Execute the tool with context injected (like wrapTools does)
    let result: string;
    try {
      const wrappedTool = { ...tool, ctx };
      const output = await wrappedTool.execute.call(wrappedTool, toolInput, {
        toolCallId,
        messages: [],
      });
      result = typeof output === "string" ? output : JSON.stringify(output);
    } catch (error) {
      result = `Error: ${error instanceof Error ? error.message : String(error)}`;
      console.error("Tool execution error:", error);
    }

    // Save the tool result - group with original message using promptMessageId
    const { messageId: toolResultId } = await approvalAgent.saveMessage(ctx, {
      threadId,
      promptMessageId: parentMessageId,
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName,
            output: { type: "text", value: result },
          },
        ],
      },
      skipEmbeddings: true,
    });

    // Continue generation so LLM can respond to the tool result.
    // Use forceNewOrder to create a separate message from the original tool call.
    const streamResult = await approvalAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId: toolResultId, forceNewOrder: true },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await streamResult.consumeStream();
  },
});

/**
 * Continue generation after tool approval/denial.
 */
export const continueGeneration = internalAction({
  args: {
    promptMessageId: v.string(),
    threadId: v.string(),
    forceNewOrder: v.optional(v.boolean()),
  },
  handler: async (ctx, { promptMessageId, threadId, forceNewOrder }) => {
    const result = await approvalAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId, forceNewOrder },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});

/**
 * Query messages with streaming support.
 */
export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const { threadId, streamArgs } = args;
    await authorizeThreadAccess(ctx, threadId);

    const streams = await syncStreams(ctx, components.agent, {
      threadId,
      streamArgs,
      // Only include streaming - finished messages come from pagination.
      // Tool approval UI data comes from message content, not streams.
    });

    const paginated = await listUIMessages(ctx, components.agent, args);

    // Debug logging
    if (streams?.kind === "list" && streams.messages.length > 0) {
      console.log("[listThreadMessages] Active streams:", streams.messages.map(m => ({
        streamId: m.streamId,
        order: m.order,
        stepOrder: m.stepOrder,
        status: m.status,
      })));
    }
    if (paginated.page.length > 0) {
      console.log("[listThreadMessages] Paginated UIMessages:", paginated.page.map(m => ({
        order: m.order,
        stepOrder: m.stepOrder,
        status: m.status,
        role: m.role,
        textLen: m.text?.length,
        partsCount: m.parts?.length,
      })));
    }

    return {
      ...paginated,
      streams,
    };
  },
});
