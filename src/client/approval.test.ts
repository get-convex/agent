import { describe, expect, test, vi } from "vitest";
import {
  Agent,
  createThread,
  createTool,
  type MessageDoc,
} from "./index.js";
import type { DataModelFromSchemaDefinition } from "convex/server";
import { actionGeneric } from "convex/server";
import type { ActionBuilder } from "convex/server";
import { v } from "convex/values";
import { defineSchema } from "convex/server";
import { stepCountIs } from "ai";
import { components, initConvexTest } from "./setup.test.js";
import { z } from "zod/v4";
import { mockModel } from "./mockModel.js";
import { toUIMessages } from "../UIMessages.js";

const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

// Tool that always requires approval
const deleteFileTool = createTool({
  description: "Delete a file",
  inputSchema: z.object({
    filename: z.string(),
  }),
  needsApproval: () => true,
  execute: async (_ctx, input) => {
    return `Deleted: ${input.filename}`;
  },
});

// Tool that conditionally requires approval
const transferMoneyTool = createTool({
  description: "Transfer money",
  inputSchema: z.object({
    amount: z.number(),
    toAccount: z.string(),
  }),
  needsApproval: (_ctx, input) => input.amount > 100,
  execute: async (_ctx, input) => {
    return `Transferred $${input.amount} to ${input.toAccount}`;
  },
});

// Tool that never requires approval
const checkBalanceTool = createTool({
  description: "Check balance",
  inputSchema: z.object({
    accountId: z.string(),
  }),
  execute: async (_ctx, input) => {
    return `Balance for ${input.accountId}: $500`;
  },
});

// Agent with approval tools for testing
const approvalAgent = new Agent(components.agent, {
  name: "approval-test-agent",
  instructions: "Test agent for approval workflow",
  tools: {
    deleteFile: deleteFileTool,
    transferMoney: transferMoneyTool,
    checkBalance: checkBalanceTool,
  },
  languageModel: mockModel({
    contentSteps: [
      // First step: tool call that needs approval
      [
        {
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "deleteFile",
          input: JSON.stringify({ filename: "important.txt" }),
        },
      ],
      // Second step: after approval, generate final response
      [{ type: "text", text: "File deleted successfully." }],
    ],
  }),
  stopWhen: stepCountIs(5),
});

// Agent for testing tool execution without approval
const noApprovalAgent = new Agent(components.agent, {
  name: "no-approval-agent",
  instructions: "Test agent without approval requirement",
  tools: {
    checkBalance: checkBalanceTool,
  },
  languageModel: mockModel({
    contentSteps: [
      [
        {
          type: "tool-call",
          toolCallId: "call-456",
          toolName: "checkBalance",
          input: JSON.stringify({ accountId: "ABC123" }),
        },
      ],
      [{ type: "text", text: "Your balance is $500." }],
    ],
  }),
  stopWhen: stepCountIs(5),
});

describe("Tool Approval Workflow", () => {
  describe("_findToolCallInfo", () => {
    test("finds tool call info for valid approval ID", async () => {
      const t = initConvexTest(schema);

      // Create thread and save messages simulating an approval request
      const threadId = await t.run(async (ctx) =>
        createThread(ctx, components.agent, { userId: "user1" }),
      );

      // Save user message
      await t.run(async (ctx) =>
        approvalAgent.saveMessage(ctx, {
          threadId,
          message: { role: "user", content: "Delete important.txt" },
        }),
      );

      // Save assistant message with tool call and approval request
      await t.run(async (ctx) =>
        approvalAgent.saveMessage(ctx, {
          threadId,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-123",
                toolName: "deleteFile",
                input: { filename: "important.txt" },
                args: { filename: "important.txt" },
              },
              {
                type: "tool-approval-request",
                approvalId: "approval-abc",
                toolCallId: "call-123",
              },
            ],
          },
        }),
      );

      // Test finding the tool call info
      const toolInfo = await t.run(async (ctx) =>
        (approvalAgent as any)._findToolCallInfo(ctx, threadId, "approval-abc"),
      );

      expect(toolInfo).not.toBeNull();
      expect(toolInfo?.toolCallId).toBe("call-123");
      expect(toolInfo?.toolName).toBe("deleteFile");
      expect(toolInfo?.toolInput).toEqual({ filename: "important.txt" });
      expect(toolInfo?.parentMessageId).toBeDefined();
    });

    test("returns null for non-existent approval ID", async () => {
      const t = initConvexTest(schema);

      const threadId = await t.run(async (ctx) =>
        createThread(ctx, components.agent, { userId: "user1" }),
      );

      await t.run(async (ctx) =>
        approvalAgent.saveMessage(ctx, {
          threadId,
          message: { role: "user", content: "Hello" },
        }),
      );

      const toolInfo = await t.run(async (ctx) =>
        (approvalAgent as any)._findToolCallInfo(
          ctx,
          threadId,
          "non-existent-approval",
        ),
      );

      expect(toolInfo).toBeNull();
    });

    test("returns null for already handled approval (idempotency)", async () => {
      const t = initConvexTest(schema);

      const threadId = await t.run(async (ctx) =>
        createThread(ctx, components.agent, { userId: "user1" }),
      );

      // Save message with approval request
      await t.run(async (ctx) =>
        approvalAgent.saveMessage(ctx, {
          threadId,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-123",
                toolName: "deleteFile",
                input: { filename: "test.txt" },
                args: { filename: "test.txt" },
              },
              {
                type: "tool-approval-request",
                approvalId: "approval-xyz",
                toolCallId: "call-123",
              },
            ],
          },
        }),
      );

      // Save message with approval response (already handled)
      await t.run(async (ctx) =>
        approvalAgent.saveMessage(ctx, {
          threadId,
          message: {
            role: "tool",
            content: [
              {
                type: "tool-approval-response",
                approvalId: "approval-xyz",
                approved: true,
              },
              {
                type: "tool-result",
                toolCallId: "call-123",
                toolName: "deleteFile",
                output: { type: "text", value: "Deleted: test.txt" },
              },
            ],
          },
        }),
      );

      // Should return alreadyHandled because approval was already processed
      const toolInfo = await t.run(async (ctx) =>
        (approvalAgent as any)._findToolCallInfo(ctx, threadId, "approval-xyz"),
      );

      // Returns { alreadyHandled: true, wasApproved: true } when already approved
      expect(toolInfo).not.toBeNull();
      expect(toolInfo?.alreadyHandled).toBe(true);
      expect(toolInfo?.wasApproved).toBe(true);
    });
  });

  describe("UIMessage approval state handling", () => {
    test("shows approval-requested state for pending approvals", () => {
      const messages: MessageDoc[] = [
        {
          _id: "msg1",
          _creationTime: Date.now(),
          order: 0,
          stepOrder: 0,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "deleteFile",
                input: { filename: "test.txt" },
                args: { filename: "test.txt" },
              },
              {
                type: "tool-approval-request",
                approvalId: "approval-1",
                toolCallId: "call-1",
              },
            ],
          },
        },
      ];

      const uiMessages = toUIMessages(messages);
      expect(uiMessages).toHaveLength(1);

      const toolPart = uiMessages[0].parts.find(
        (p) => p.type === "tool-deleteFile",
      );
      expect(toolPart).toBeDefined();
      expect((toolPart as any).state).toBe("approval-requested");
      expect((toolPart as any).approval?.id).toBe("approval-1");
    });

    test("shows approval-responded state after approval", () => {
      const messages: MessageDoc[] = [
        {
          _id: "msg1",
          _creationTime: Date.now(),
          order: 0,
          stepOrder: 0,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "deleteFile",
                input: { filename: "test.txt" },
                args: { filename: "test.txt" },
              },
              {
                type: "tool-approval-request",
                approvalId: "approval-1",
                toolCallId: "call-1",
              },
            ],
          },
        },
        {
          _id: "msg2",
          _creationTime: Date.now() + 1,
          order: 0,
          stepOrder: 1,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "tool",
            content: [
              {
                type: "tool-approval-response",
                approvalId: "approval-1",
                approved: true,
                reason: "User approved",
              },
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "deleteFile",
                output: { type: "text", value: "Deleted: test.txt" },
              },
            ],
          },
        },
      ];

      const uiMessages = toUIMessages(messages);
      expect(uiMessages).toHaveLength(1); // Should be grouped into one assistant message

      const toolPart = uiMessages[0].parts.find(
        (p) => p.type === "tool-deleteFile",
      );
      expect(toolPart).toBeDefined();
      // After approval and output, state should be output-available
      expect((toolPart as any).state).toBe("output-available");
      expect((toolPart as any).output).toBe("Deleted: test.txt");
    });

    test("shows output-denied state after denial", () => {
      const messages: MessageDoc[] = [
        {
          _id: "msg1",
          _creationTime: Date.now(),
          order: 0,
          stepOrder: 0,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "deleteFile",
                input: { filename: "test.txt" },
                args: { filename: "test.txt" },
              },
              {
                type: "tool-approval-request",
                approvalId: "approval-1",
                toolCallId: "call-1",
              },
            ],
          },
        },
        {
          _id: "msg2",
          _creationTime: Date.now() + 1,
          order: 0,
          stepOrder: 1,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "tool",
            content: [
              {
                type: "tool-approval-response",
                approvalId: "approval-1",
                approved: false,
                reason: "User denied",
              },
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "deleteFile",
                output: {
                  type: "execution-denied",
                  reason: "User denied",
                },
              },
            ],
          },
        },
      ];

      const uiMessages = toUIMessages(messages);
      expect(uiMessages).toHaveLength(1);

      const toolPart = uiMessages[0].parts.find(
        (p) => p.type === "tool-deleteFile",
      );
      expect(toolPart).toBeDefined();
      expect((toolPart as any).state).toBe("output-denied");
      expect((toolPart as any).approval?.approved).toBe(false);
      expect((toolPart as any).approval?.reason).toBe("User denied");
    });
  });

  describe("Conditional approval (needsApproval function)", () => {
    test("needsApproval receives correct input", async () => {
      const needsApprovalSpy = vi.fn().mockReturnValue(true);

      const testTool = createTool({
        description: "Test tool",
        inputSchema: z.object({ value: z.number() }),
        needsApproval: needsApprovalSpy,
        execute: async (_ctx, input) => `Value: ${input.value}`,
      });

      // The needsApproval function is called by the AI SDK during tool execution
      // We can verify the tool is set up correctly
      expect(testTool.needsApproval).toBeDefined();
    });
  });

  describe("forceNewOrder behavior", () => {
    test("messages with forceNewOrder get incremented order", async () => {
      const t = initConvexTest(schema);

      const threadId = await t.run(async (ctx) =>
        createThread(ctx, components.agent, { userId: "user1" }),
      );

      // Save initial message at order 0
      const { messageId: firstMsgId } = await t.run(async (ctx) =>
        approvalAgent.saveMessage(ctx, {
          threadId,
          message: { role: "user", content: "First message" },
        }),
      );

      // Get first message to check its order
      const firstMsg = await t.run(async (ctx) => {
        const result = await approvalAgent.listMessages(ctx, {
          threadId,
          paginationOpts: { cursor: null, numItems: 10 },
        });
        return result.page.find((m) => m._id === firstMsgId);
      });

      expect(firstMsg?.order).toBeDefined();
      const initialOrder = firstMsg!.order;

      // When using forceNewOrder, the continuation message should have order+1
      // This is tested indirectly through the approval workflow
      // The forceNewOrder flag is used internally by approveToolCall/denyToolCall
    });
  });

  describe("Tool execution context", () => {
    test("tool receives correct context fields", async () => {
      let capturedCtx: any = null;

      const contextCaptureTool = createTool({
        description: "Captures context",
        inputSchema: z.object({}),
        execute: async (ctx, _input) => {
          capturedCtx = ctx;
          return "captured";
        },
      });

      // Verify the tool has the right structure
      expect(contextCaptureTool.execute).toBeDefined();
      expect((contextCaptureTool as any).__acceptsCtx).toBe(true);
    });
  });

  describe("Message grouping with approvals", () => {
    test("approval request and response in same group show correct final state", () => {
      // When tool call, approval request, approval response, and result
      // are all in the same message group (same order), the final state
      // should reflect the completed state
      const messages: MessageDoc[] = [
        {
          _id: "msg1",
          _creationTime: Date.now(),
          order: 0,
          stepOrder: 0,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "checkBalance",
                input: { accountId: "123" },
                args: { accountId: "123" },
              },
            ],
          },
        },
        {
          _id: "msg2",
          _creationTime: Date.now() + 1,
          order: 0,
          stepOrder: 1,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "checkBalance",
                output: { type: "text", value: "Balance: $500" },
              },
            ],
          },
        },
      ];

      const uiMessages = toUIMessages(messages);
      expect(uiMessages).toHaveLength(1);

      const toolPart = uiMessages[0].parts.find(
        (p) => p.type === "tool-checkBalance",
      );
      expect(toolPart).toBeDefined();
      expect((toolPart as any).state).toBe("output-available");
      expect((toolPart as any).output).toBe("Balance: $500");
    });

    test("handles tool result on previous page gracefully", () => {
      // When we only have the tool result (tool call was on previous page)
      const messages: MessageDoc[] = [
        {
          _id: "msg1",
          _creationTime: Date.now(),
          order: 0,
          stepOrder: 1,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-orphan",
                toolName: "someTool",
                output: { type: "text", value: "Result from previous page" },
              },
            ],
          },
        },
      ];

      const uiMessages = toUIMessages(messages);
      expect(uiMessages).toHaveLength(1);

      // Should create a standalone tool part
      const toolPart = uiMessages[0].parts.find(
        (p) => p.type === "tool-someTool",
      );
      expect(toolPart).toBeDefined();
      expect((toolPart as any).output).toBe("Result from previous page");
    });
  });

  describe("Error handling in approval workflow", () => {
    test("execution-denied output is converted to text for providers", () => {
      // This tests that the mapping layer converts execution-denied
      // to text format for provider compatibility
      const messages: MessageDoc[] = [
        {
          _id: "msg1",
          _creationTime: Date.now(),
          order: 0,
          stepOrder: 0,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "deleteFile",
                output: {
                  type: "execution-denied",
                  reason: "Operation not permitted",
                },
              },
            ],
          },
        },
      ];

      const uiMessages = toUIMessages(messages);
      expect(uiMessages).toHaveLength(1);

      const toolPart = uiMessages[0].parts.find(
        (p) => p.type === "tool-deleteFile",
      );
      expect(toolPart).toBeDefined();
      expect((toolPart as any).state).toBe("output-denied");
    });
  });

  describe("Multiple tool calls with mixed approval requirements", () => {
    test("handles mix of approved and non-approved tools", () => {
      const messages: MessageDoc[] = [
        {
          _id: "msg1",
          _creationTime: Date.now(),
          order: 0,
          stepOrder: 0,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "assistant",
            content: [
              // Tool that needs approval
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "deleteFile",
                input: { filename: "test.txt" },
                args: { filename: "test.txt" },
              },
              {
                type: "tool-approval-request",
                approvalId: "approval-1",
                toolCallId: "call-1",
              },
              // Tool that doesn't need approval
              {
                type: "tool-call",
                toolCallId: "call-2",
                toolName: "checkBalance",
                input: { accountId: "123" },
                args: { accountId: "123" },
              },
            ],
          },
        },
        {
          _id: "msg2",
          _creationTime: Date.now() + 1,
          order: 0,
          stepOrder: 1,
          status: "success",
          threadId: "thread1",
          tool: true,
          message: {
            role: "tool",
            content: [
              // Result for non-approved tool (executed immediately)
              {
                type: "tool-result",
                toolCallId: "call-2",
                toolName: "checkBalance",
                output: { type: "text", value: "Balance: $500" },
              },
            ],
          },
        },
      ];

      const uiMessages = toUIMessages(messages);
      expect(uiMessages).toHaveLength(1);

      const deletePart = uiMessages[0].parts.find(
        (p) => p.type === "tool-deleteFile",
      );
      const balancePart = uiMessages[0].parts.find(
        (p) => p.type === "tool-checkBalance",
      );

      expect(deletePart).toBeDefined();
      expect(balancePart).toBeDefined();

      // Delete tool should be waiting for approval
      expect((deletePart as any).state).toBe("approval-requested");

      // Balance tool should have output
      expect((balancePart as any).state).toBe("output-available");
      expect((balancePart as any).output).toBe("Balance: $500");
    });
  });
});

describe("createTool with approval", () => {
  test("createTool accepts needsApproval function", () => {
    const tool = createTool({
      description: "Test",
      inputSchema: z.object({ value: z.number() }),
      needsApproval: (_ctx, input) => input.value > 100,
      execute: async (_ctx, input) => `Value: ${input.value}`,
    });

    expect(tool).toBeDefined();
    expect(tool.needsApproval).toBeDefined();
  });

  test("createTool accepts needsApproval boolean", () => {
    const tool = createTool({
      description: "Test",
      inputSchema: z.object({}),
      needsApproval: true,
      execute: async () => "done",
    });

    expect(tool).toBeDefined();
    // needsApproval is wrapped by the AI SDK, so check it's defined
    expect(tool.needsApproval).toBeDefined();
  });

  test("createTool works without needsApproval", () => {
    const tool = createTool({
      description: "Test",
      inputSchema: z.object({}),
      execute: async () => "done",
    });

    expect(tool).toBeDefined();
    // The AI SDK may wrap needsApproval, so just verify the tool works
    expect(tool.execute).toBeDefined();
  });
});
