/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { Agent, createTool, stepCountIs, mockModel } from "@convex-dev/agent";
import { v } from "convex/values";
import { defineTestApp } from "convex-test";
import agentTest from "@convex-dev/agent/test";
import schema from "./schema.js";
import { z } from "zod/v4";
import * as usageHandlerModule from "./usage_tracking/usageHandler.js";
import { usageHandler } from "./usage_tracking/usageHandler.js";
import { rawRequestResponseHandler } from "./debugging/rawRequestResponseHandler.js";

const app = defineTestApp({
  schema,
  components: { agent: agentTest },
});

// Same tools as the example approval agent
const deleteFileTool = createTool({
  description: "Delete a file from the system",
  inputSchema: z.object({
    filename: z.string().describe("The name of the file to delete"),
  }),
  needsApproval: () => true,
  execute: async (_ctx, input) => {
    return `Successfully deleted file: ${input.filename}`;
  },
});

const transferMoneyTool = createTool({
  description: "Transfer money to an account",
  inputSchema: z.object({
    amount: z.number().describe("The amount to transfer"),
    toAccount: z.string().describe("The destination account"),
  }),
  needsApproval: async (_ctx, input) => {
    return input.amount > 100;
  },
  execute: async (_ctx, input) => {
    return `Transferred $${input.amount} to account ${input.toAccount}`;
  },
});

// Agent that mirrors the real example config: same tools, same usageHandler,
// same rawRequestResponseHandler — but with a mock model that produces tool calls.
const testApprovalAgent = new Agent(app.components.agent, {
  name: "Approval Demo Agent",
  instructions:
    "You are a helpful assistant that can delete files and transfer money.",
  tools: {
    deleteFile: deleteFileTool,
    transferMoney: transferMoneyTool,
  },
  languageModel: mockModel({
    contentSteps: [
      [
        {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "deleteFile",
          input: JSON.stringify({ filename: "important.txt" }),
        },
      ],
      [{ type: "text", text: "I deleted the file important.txt." }],
    ],
  }),
  stopWhen: stepCountIs(5),
  // These are the real handlers from the example — the exact code that runs in prod
  usageHandler,
  rawRequestResponseHandler,
});

const testDenialAgent = new Agent(app.components.agent, {
  name: "Approval Demo Agent",
  instructions:
    "You are a helpful assistant that can delete files and transfer money.",
  tools: {
    deleteFile: deleteFileTool,
    transferMoney: transferMoneyTool,
  },
  languageModel: mockModel({
    contentSteps: [
      [
        {
          type: "tool-call",
          toolCallId: "tc-2",
          toolName: "deleteFile",
          input: JSON.stringify({ filename: "secret.txt" }),
        },
      ],
      [{ type: "text", text: "Understood, I won't delete that file." }],
    ],
  }),
  stopWhen: stepCountIs(5),
  usageHandler,
  rawRequestResponseHandler,
});

// Agent with two tool calls in a single step — both need approval.
// This exercises write-time merging of approval responses into a single message.
const testMultiToolApprovalAgent = new Agent(app.components.agent, {
  name: "Multi-Tool Approval Agent",
  instructions:
    "You are a helpful assistant that can delete files and transfer money.",
  tools: {
    deleteFile: deleteFileTool,
    transferMoney: transferMoneyTool,
  },
  languageModel: mockModel({
    contentSteps: [
      // Step 1: model calls two tools at once
      [
        {
          type: "tool-call",
          toolCallId: "tc-multi-1",
          toolName: "deleteFile",
          input: JSON.stringify({ filename: "data.csv" }),
        },
        {
          type: "tool-call",
          toolCallId: "tc-multi-2",
          toolName: "transferMoney",
          input: JSON.stringify({ amount: 500, toAccount: "savings" }),
        },
      ],
      // Step 2: model responds after both tools execute
      [{ type: "text", text: "Done! Deleted data.csv and transferred $500." }],
    ],
  }),
  stopWhen: stepCountIs(5),
  usageHandler,
  rawRequestResponseHandler,
});

// --- Test actions that mirror example/convex/chat/approval.ts ---

const testApproveE2E = app.action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ secondText: string; totalThreadMessages: number }> => {
    const { thread } = await testApprovalAgent.createThread(ctx, {
      userId: "test user",
    });

    // Step 1: streamText (same as generateResponse in the example)
    const result1 = await testApprovalAgent.streamText(
      ctx,
      { threadId: thread.threadId },
      { prompt: "Delete important.txt" },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result1.consumeStream();

    // Find the approval request in saved messages
    const approvalMsg = result1.savedMessages?.find(
      (m) =>
        Array.isArray(m.message?.content) &&
        m.message!.content.some((p: any) => p.type === "tool-approval-request"),
    );
    if (!approvalMsg)
      throw new Error("No approval request found in saved messages");
    const approvalPart = (approvalMsg.message!.content as any[]).find(
      (p: any) => p.type === "tool-approval-request",
    );

    // Step 2: Approve (same as handleApproval in the example)
    const { messageId } = await ctx.runMutation(
      api.approval.submitApprovalForTestApprovalAgent,
      { threadId: thread.threadId, approvalId: approvalPart.approvalId },
    );

    // Step 3: Continue with streamText (same as handleApproval continuation)
    const result2 = await testApprovalAgent.streamText(
      ctx,
      { threadId: thread.threadId },
      { promptMessageId: messageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result2.consumeStream();

    // Verify thread messages
    const allMessages = await testApprovalAgent.listMessages(ctx, {
      threadId: thread.threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    });

    return {
      secondText: await result2.text,
      totalThreadMessages: allMessages.page.length,
    };
  },
});

const testDenyE2E = app.action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ secondText: string; totalThreadMessages: number }> => {
    const { thread } = await testDenialAgent.createThread(ctx, {
      userId: "test user",
    });

    const result1 = await testDenialAgent.streamText(
      ctx,
      { threadId: thread.threadId },
      { prompt: "Delete secret.txt" },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result1.consumeStream();

    const approvalMsg = result1.savedMessages?.find(
      (m) =>
        Array.isArray(m.message?.content) &&
        m.message!.content.some((p: any) => p.type === "tool-approval-request"),
    );
    if (!approvalMsg) throw new Error("No approval request found");
    const approvalPart = (approvalMsg.message!.content as any[]).find(
      (p: any) => p.type === "tool-approval-request",
    );

    const { messageId } = await ctx.runMutation(
      api.approval.submitDenialForTestDenialAgent,
      {
        threadId: thread.threadId,
        approvalId: approvalPart.approvalId,
        reason: "This file is important",
      },
    );

    const result2 = await testDenialAgent.streamText(
      ctx,
      { threadId: thread.threadId },
      { promptMessageId: messageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result2.consumeStream();

    const allMessages = await testDenialAgent.listMessages(ctx, {
      threadId: thread.threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    });

    return {
      secondText: await result2.text,
      totalThreadMessages: allMessages.page.length,
    };
  },
});

const testMultiToolApproveE2E = app.action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    secondText: string;
    totalThreadMessages: number;
    approvalCount: number;
  }> => {
    const { thread } = await testMultiToolApprovalAgent.createThread(ctx, {
      userId: "test user",
    });

    // Step 1: streamText triggers two tool calls that both need approval
    const result1 = await testMultiToolApprovalAgent.streamText(
      ctx,
      { threadId: thread.threadId },
      { prompt: "Delete data.csv and transfer $500 to savings" },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result1.consumeStream();

    // Find all approval requests in saved messages
    const approvalParts: { approvalId: string; toolName: string }[] = [];
    for (const m of result1.savedMessages ?? []) {
      if (!Array.isArray(m.message?.content)) continue;
      for (const part of m.message!.content as any[]) {
        if (part.type === "tool-approval-request") {
          approvalParts.push({
            approvalId: part.approvalId,
            toolName: part.toolCallId,
          });
        }
      }
    }
    if (approvalParts.length < 2) {
      throw new Error(
        `Expected 2 approval requests, found ${approvalParts.length}`,
      );
    }

    // Approve both tools one at a time. The second approval merges into the
    // same message as the first (write-time merging), so both return the same
    // messageId and the SDK sees a single tool message for the step.
    let lastMessageId: string | undefined;
    for (const { approvalId } of approvalParts) {
      const { messageId } = await ctx.runMutation(
        api.approval.submitApprovalForTestMultiToolAgent,
        { threadId: thread.threadId, approvalId },
      );
      lastMessageId = messageId;
    }

    // Step 2: Continue — the SDK must see both approval responses merged
    const result2 = await testMultiToolApprovalAgent.streamText(
      ctx,
      { threadId: thread.threadId },
      { promptMessageId: lastMessageId! },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result2.consumeStream();

    const allMessages = await testMultiToolApprovalAgent.listMessages(ctx, {
      threadId: thread.threadId,
      paginationOpts: { cursor: null, numItems: 30 },
    });

    return {
      secondText: await result2.text,
      totalThreadMessages: allMessages.page.length,
      approvalCount: approvalParts.length,
    };
  },
});

const submitApprovalForTestApprovalAgent = app.mutation({
  args: {
    threadId: v.string(),
    approvalId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, approvalId, reason }) => {
    return testApprovalAgent.approveToolCall(ctx, {
      threadId,
      approvalId,
      reason,
    });
  },
});

const submitDenialForTestDenialAgent = app.mutation({
  args: {
    threadId: v.string(),
    approvalId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, approvalId, reason }) => {
    return testDenialAgent.denyToolCall(ctx, { threadId, approvalId, reason });
  },
});

const submitApprovalForTestMultiToolAgent = app.mutation({
  args: {
    threadId: v.string(),
    approvalId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, approvalId, reason }) => {
    return testMultiToolApprovalAgent.approveToolCall(ctx, {
      threadId,
      approvalId,
      reason,
    });
  },
});

const { api, createTest } = app.defineModules({
  approval: {
    testApproveE2E,
    testDenyE2E,
    testMultiToolApproveE2E,
    submitApprovalForTestApprovalAgent,
    submitDenialForTestDenialAgent,
    submitApprovalForTestMultiToolAgent,
  },
  "usage_tracking/usageHandler": usageHandlerModule,
});

describe("Example Approval E2E (exercises usageHandler + insertRawUsage)", () => {
  test("approve flow: streamText → approval → tool executes → usageHandler persists", async () => {
    const t = createTest();
    const result = await t.action(api.approval.testApproveE2E, {});

    expect(result.secondText).toBe("I deleted the file important.txt.");
    expect(result.totalThreadMessages).toBeGreaterThanOrEqual(4);

    // Verify rawUsage records were created by the real usageHandler
    const rawUsageDocs = await t.run(async (ctx) => {
      return await ctx.db.query("rawUsage").collect();
    });
    expect(rawUsageDocs.length).toBeGreaterThanOrEqual(2);
    // Verify the stored data matches our schema
    for (const doc of rawUsageDocs) {
      expect(doc.usage.promptTokens).toBeTypeOf("number");
      expect(doc.usage.completionTokens).toBeTypeOf("number");
      expect(doc.usage.totalTokens).toBeTypeOf("number");
      expect(doc.billingPeriod).toBeDefined();
      expect(doc.userId).toBe("test user");
      expect(doc.agentName).toBe("Approval Demo Agent");
    }
  });

  test("multi-tool approval: two tools need approval → both approved → both execute", async () => {
    const t = createTest();
    const result = await t.action(api.approval.testMultiToolApproveE2E, {});

    expect(result.approvalCount).toBe(2);
    expect(result.secondText).toBe(
      "Done! Deleted data.csv and transferred $500.",
    );
    expect(result.totalThreadMessages).toBeGreaterThanOrEqual(4);
  });

  test("deny flow: streamText → denial → model responds → usageHandler persists", async () => {
    const t = createTest();
    const result = await t.action(api.approval.testDenyE2E, {});

    expect(result.secondText).toBe("Understood, I won't delete that file.");
    expect(result.totalThreadMessages).toBeGreaterThanOrEqual(4);

    const rawUsageDocs = await t.run(async (ctx) => {
      return await ctx.db.query("rawUsage").collect();
    });
    expect(rawUsageDocs.length).toBeGreaterThanOrEqual(2);
  });
});
