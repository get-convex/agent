import { describe, expect, test } from "vitest";
import { Agent, createTool } from "./index.js";
import type {
  DataModelFromSchemaDefinition,
  ApiFromModules,
  ActionBuilder,
} from "convex/server";
import { anyApi, actionGeneric } from "convex/server";
import { defineSchema } from "convex/server";
import { stepCountIs, type LanguageModelUsage } from "ai";
import { components, initConvexTest } from "./setup.test.js";
import { z } from "zod/v4";
import { mockModel } from "./mockModel.js";
import type { UsageHandler } from "./types.js";

const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

// Tool that always requires approval
const deleteFileTool = createTool({
  description: "Delete a file",
  inputSchema: z.object({ filename: z.string() }),
  needsApproval: () => true,
  execute: async (_ctx, input) => `Deleted: ${input.filename}`,
});

// Track usage handler calls to verify the full flow is exercised
const usageCalls: LanguageModelUsage[] = [];
const testUsageHandler: UsageHandler = async (_ctx, args) => {
  usageCalls.push(args.usage);
};

function getApprovalIdFromSavedMessages(
  savedMessages:
    | Array<{
        message?: { content: unknown };
      }>
    | undefined,
): string {
  const approvalRequest = savedMessages
    ?.flatMap((savedMessage) =>
      Array.isArray(savedMessage.message?.content)
        ? savedMessage.message.content
        : [],
    )
    .find((part) => {
      const maybeApproval = part as { type?: unknown };
      return maybeApproval.type === "tool-approval-request";
    }) as { approvalId?: unknown } | undefined;
  if (typeof approvalRequest?.approvalId !== "string") {
    throw new Error("No approval request found in saved messages");
  }
  return approvalRequest.approvalId;
}

// --- Agents (separate mock model instances to avoid shared callIndex) ---

const approvalAgent = new Agent(components.agent, {
  name: "approval-test",
  instructions: "You delete files when asked.",
  tools: { deleteFile: deleteFileTool },
  languageModel: mockModel({
    contentSteps: [
      // Step 1: model makes a tool call (LanguageModelV3 uses `input` as JSON string)
      [
        {
          type: "tool-call",
          toolCallId: "tc-approve",
          toolName: "deleteFile",
          input: JSON.stringify({ filename: "test.txt" }),
        },
      ],
      // Step 2: after tool execution, model responds with text
      [{ type: "text", text: "Done! I deleted test.txt." }],
    ],
  }),
  stopWhen: stepCountIs(5),
  usageHandler: testUsageHandler,
});

const denialAgent = new Agent(components.agent, {
  name: "denial-test",
  instructions: "You delete files when asked.",
  tools: { deleteFile: deleteFileTool },
  languageModel: mockModel({
    contentSteps: [
      [
        {
          type: "tool-call",
          toolCallId: "tc-deny",
          toolName: "deleteFile",
          input: JSON.stringify({ filename: "secret.txt" }),
        },
      ],
      [{ type: "text", text: "OK, I won't delete that file." }],
    ],
  }),
  stopWhen: stepCountIs(5),
  usageHandler: testUsageHandler,
});

// --- Test helpers ---

export const testApproveFlow = action({
  args: {},
  handler: async (ctx) => {
    const { thread } = await approvalAgent.createThread(ctx, { userId: "u1" });

    // Step 1: Generate text — model returns tool call, SDK sees needsApproval → stops
    const result1 = await thread.generateText({
      prompt: "Delete test.txt",
    });

    const approvalId = getApprovalIdFromSavedMessages(result1.savedMessages);

    // Step 2: Approve the tool call
    const { messageId } = await approvalAgent.approveToolCall(ctx, {
      threadId: thread.threadId,
      approvalId,
    });

    // Step 3: Continue generation — SDK executes tool, model responds
    const result2 = await thread.generateText({
      promptMessageId: messageId,
    });

    // Verify thread has all messages persisted
    const allMessages = await approvalAgent.listMessages(ctx, {
      threadId: thread.threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    });

    return {
      approvalId,
      firstText: result1.text,
      secondText: result2.text,
      firstSavedCount: result1.savedMessages?.length ?? 0,
      secondSavedCount: result2.savedMessages?.length ?? 0,
      totalThreadMessages: allMessages.page.length,
      threadMessageRoles: allMessages.page.map((m) => m.message?.role),
      usageCallCount: usageCalls.length,
      // Verify usage data includes detail fields (AI SDK v6)
      lastUsage: usageCalls.at(-1),
    };
  },
});

export const testDenyFlow = action({
  args: {},
  handler: async (ctx) => {
    const { thread } = await denialAgent.createThread(ctx, { userId: "u2" });

    // Step 1: Generate — model returns tool call, approval requested
    const result1 = await thread.generateText({
      prompt: "Delete secret.txt",
    });

    const approvalId = getApprovalIdFromSavedMessages(result1.savedMessages);

    // Step 2: Deny the tool call
    const { messageId } = await denialAgent.denyToolCall(ctx, {
      threadId: thread.threadId,
      approvalId,
      reason: "This file is important",
    });

    // Step 3: Continue generation — SDK creates execution-denied, model responds
    const result2 = await thread.generateText({
      promptMessageId: messageId,
    });

    // Verify thread state
    const allMessages = await denialAgent.listMessages(ctx, {
      threadId: thread.threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    });

    return {
      approvalId,
      firstText: result1.text,
      secondText: result2.text,
      totalThreadMessages: allMessages.page.length,
      threadMessageRoles: allMessages.page.map((m) => m.message?.role),
      usageCallCount: usageCalls.length,
      lastUsage: usageCalls.at(-1),
    };
  },
});

const testApi: ApiFromModules<{
  fns: {
    testApproveFlow: typeof testApproveFlow;
    testDenyFlow: typeof testDenyFlow;
  };
}>["fns"] = anyApi["approval.test"] as any;

describe("Tool Approval Workflow", () => {
  test("approve: generate → approval request → approve → tool executes → final text", async () => {
    usageCalls.length = 0;
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testApproveFlow, {});

    expect(result.approvalId).toBeDefined();
    // First call produces no text (just a tool call)
    expect(result.firstText).toBe("");
    // Second call produces the final text
    expect(result.secondText).toBe("Done! I deleted test.txt.");
    // First call: user message + assistant (tool-call + approval-request)
    expect(result.firstSavedCount).toBeGreaterThanOrEqual(2);
    // Second call: tool-result + assistant text
    expect(result.secondSavedCount).toBeGreaterThanOrEqual(1);
    // Thread should have: user, assistant(tool-call+approval), tool(approval-response),
    // tool(tool-result), assistant(text)
    expect(result.totalThreadMessages).toBeGreaterThanOrEqual(4);
    // Usage handler should be called for each generateText call
    expect(result.usageCallCount).toBeGreaterThanOrEqual(2);
    // Usage data should include AI SDK v6 detail fields
    expect(result.lastUsage).toBeDefined();
    expect(result.lastUsage!.inputTokenDetails).toBeDefined();
    expect(result.lastUsage!.outputTokenDetails).toBeDefined();
  });

  test("deny: generate → approval request → deny → model acknowledges denial", async () => {
    usageCalls.length = 0;
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testDenyFlow, {});

    expect(result.approvalId).toBeDefined();
    expect(result.firstText).toBe("");
    expect(result.secondText).toBe("OK, I won't delete that file.");
    expect(result.totalThreadMessages).toBeGreaterThanOrEqual(4);
    // Usage handler exercised
    expect(result.usageCallCount).toBeGreaterThanOrEqual(2);
    expect(result.lastUsage!.inputTokenDetails).toBeDefined();
    expect(result.lastUsage!.outputTokenDetails).toBeDefined();
  });
});
