/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { Agent, createTool, stepCountIs, mockModel } from "@convex-dev/agent";
import { anyApi, actionGeneric } from "convex/server";
import type { ApiFromModules, ActionBuilder } from "convex/server";
import { components } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import { z } from "zod/v4";
import { usageHandler } from "./usage_tracking/usageHandler.js";
import { rawRequestResponseHandler } from "./debugging/rawRequestResponseHandler.js";
import type { DataModel } from "./_generated/dataModel.js";

const action = actionGeneric as ActionBuilder<DataModel, "public">;

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
const testApprovalAgent = new Agent(components.agent, {
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

const testDenialAgent = new Agent(components.agent, {
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

// --- Test actions that mirror example/convex/chat/approval.ts ---

export const testApproveE2E = action({
  args: {},
  handler: async (ctx) => {
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
        m.message!.content.some(
          (p: any) => p.type === "tool-approval-request",
        ),
    );
    if (!approvalMsg)
      throw new Error("No approval request found in saved messages");
    const approvalPart = (approvalMsg.message!.content as any[]).find(
      (p: any) => p.type === "tool-approval-request",
    );

    // Step 2: Approve (same as handleApproval in the example)
    const { messageId } = await testApprovalAgent.approveToolCall(ctx, {
      threadId: thread.threadId,
      approvalId: approvalPart.approvalId,
    });

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

export const testDenyE2E = action({
  args: {},
  handler: async (ctx) => {
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
        m.message!.content.some(
          (p: any) => p.type === "tool-approval-request",
        ),
    );
    if (!approvalMsg) throw new Error("No approval request found");
    const approvalPart = (approvalMsg.message!.content as any[]).find(
      (p: any) => p.type === "tool-approval-request",
    );

    const { messageId } = await testDenialAgent.denyToolCall(ctx, {
      threadId: thread.threadId,
      approvalId: approvalPart.approvalId,
      reason: "This file is important",
    });

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

const testApi: ApiFromModules<{
  fns: {
    testApproveE2E: typeof testApproveE2E;
    testDenyE2E: typeof testDenyE2E;
  };
}>["fns"] = anyApi["approval.test"] as any;

describe("Example Approval E2E (exercises usageHandler + insertRawUsage)", () => {
  test("approve flow: streamText → approval → tool executes → usageHandler persists", async () => {
    const t = initConvexTest();
    const result = await t.action(testApi.testApproveE2E, {});

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

  test("deny flow: streamText → denial → model responds → usageHandler persists", async () => {
    const t = initConvexTest();
    const result = await t.action(testApi.testDenyE2E, {});

    expect(result.secondText).toBe(
      "Understood, I won't delete that file.",
    );
    expect(result.totalThreadMessages).toBeGreaterThanOrEqual(4);

    const rawUsageDocs = await t.run(async (ctx) => {
      return await ctx.db.query("rawUsage").collect();
    });
    expect(rawUsageDocs.length).toBeGreaterThanOrEqual(2);
  });
});
