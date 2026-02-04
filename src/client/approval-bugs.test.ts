/**
 * Tests designed to find actual bugs in the tool approval workflow.
 * These tests probe edge cases and stress conditions.
 */
import { describe, expect, test } from "vitest";
import {
  Agent,
  createThread,
  createTool,
  type MessageDoc,
} from "./index.js";
import type { DataModelFromSchemaDefinition } from "convex/server";
import { defineSchema } from "convex/server";
import { stepCountIs } from "ai";
import { components, initConvexTest } from "./setup.test.js";
import { z } from "zod/v4";
import { mockModel } from "./mockModel.js";
import { toUIMessages } from "../UIMessages.js";

const schema = defineSchema({});

// Simple agent for testing
const testAgent = new Agent(components.agent, {
  name: "test-agent",
  instructions: "Test",
  tools: {
    testTool: createTool({
      description: "Test tool",
      inputSchema: z.object({ value: z.string() }),
      needsApproval: () => true,
      execute: async (_ctx, input) => `Result: ${input.value}`,
    }),
  },
  languageModel: mockModel(),
  stopWhen: stepCountIs(3),
});

// These tests are obsolete with the new API that accepts direct parameters
describe.skip("Pagination in _findToolCallInfo", () => {
  test("finds approval within 20-message window (newest first)", async () => {
    const t = initConvexTest(schema);

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    // Add the approval request first (oldest)
    await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "old-call",
              toolName: "testTool",
              input: { value: "old" },
              args: { value: "old" },
            },
            {
              type: "tool-approval-request",
              approvalId: "old-approval",
              toolCallId: "old-call",
            },
          ],
        },
      }),
    );

    // Add 25 messages AFTER the approval to push it out of the window
    for (let i = 0; i < 25; i++) {
      await t.run(async (ctx) =>
        testAgent.saveMessage(ctx, {
          threadId,
          message: { role: "user", content: `Message ${i}` },
        }),
      );
    }

    // The approval is now the oldest message, outside the 20-message window
    // (messages are returned newest-first by default)
    const toolInfo = await t.run(async (ctx) =>
      (testAgent as any)._findToolCallInfo(ctx, threadId, "old-approval"),
    );

    // BUG CONFIRMED: With 25+ newer messages, the old approval is not found
    // because listMessages returns newest first and only fetches 20
    expect(toolInfo).toBeNull();
  });

  test("finds recent approval within window", async () => {
    const t = initConvexTest(schema);

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    // Add some older messages first
    for (let i = 0; i < 5; i++) {
      await t.run(async (ctx) =>
        testAgent.saveMessage(ctx, {
          threadId,
          message: { role: "user", content: `Old message ${i}` },
        }),
      );
    }

    // Add the approval request (recent)
    await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "recent-call",
              toolName: "testTool",
              input: { value: "recent" },
              args: { value: "recent" },
            },
            {
              type: "tool-approval-request",
              approvalId: "recent-approval",
              toolCallId: "recent-call",
            },
          ],
        },
      }),
    );

    const toolInfo = await t.run(async (ctx) =>
      (testAgent as any)._findToolCallInfo(ctx, threadId, "recent-approval"),
    );

    // Recent approvals should be found
    expect(toolInfo).not.toBeNull();
    expect(toolInfo?.toolName).toBe("testTool");
  });
});

// Obsolete - new API doesn't look up tool info
describe.skip("Bug: Tool call and approval request in different messages", () => {
  test("fails when tool-call and tool-approval-request are in separate messages", async () => {
    const t = initConvexTest(schema);

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    // Save tool call in one message
    await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "split-call",
              toolName: "testTool",
              input: { value: "split" },
              args: { value: "split" },
            },
          ],
        },
      }),
    );

    // Save approval request in a different message (unusual but possible)
    await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-approval-request",
              approvalId: "split-approval",
              toolCallId: "split-call",
            },
          ],
        },
      }),
    );

    const toolInfo = await t.run(async (ctx) =>
      (testAgent as any)._findToolCallInfo(ctx, threadId, "split-approval"),
    );

    // The code should still find the tool call even if it's in a different message
    // BUG: parentMessageId will be set to the approval message, not the tool-call message
    expect(toolInfo).not.toBeNull();
    expect(toolInfo?.toolName).toBe("testTool");
    expect(toolInfo?.toolInput).toEqual({ value: "split" });
  });
});

describe("Tool not registered on agent calling approveToolCall", () => {
  test("succeeds even when tool is not on the agent instance (save-only)", async () => {
    const t = initConvexTest(schema);

    // Agent without the tool
    const agentWithoutTool = new Agent(components.agent, {
      name: "no-tools",
      instructions: "Test",
      languageModel: mockModel(),
    });

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    // Save a tool call from a different agent that has the tool
    const { messageId: parentMessageId } = await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "cross-agent-call",
              toolName: "testTool", // This tool exists on testAgent but not agentWithoutTool
              input: { value: "cross" },
              args: { value: "cross" },
            },
            {
              type: "tool-approval-request",
              approvalId: "cross-agent-approval",
              toolCallId: "cross-agent-call",
            },
          ],
        },
      }),
    );

    // approveToolCall no longer executes tools — it just saves the approval
    // as a pending message. Any agent can approve regardless of tool registration.
    const result = await t.run(async (ctx) =>
      agentWithoutTool.approveToolCall(ctx as any, {
        threadId,
        toolCallId: "cross-agent-call",
        toolName: "testTool",
        args: { value: "cross" },
        parentMessageId,
        approvalId: "cross-agent-approval",
      }),
    );

    expect(result.messageId).toBeDefined();

    // Verify the saved message is pending with approval content
    const messages = await t.run(async (ctx) => {
      const res = await agentWithoutTool.listMessages(ctx, {
        threadId,
        paginationOpts: { cursor: null, numItems: 10 },
        statuses: ["pending"],
      });
      return res.page;
    });

    const approvalMsg = messages.find((m) => m._id === result.messageId);
    expect(approvalMsg).toBeDefined();
    expect(approvalMsg?.status).toBe("pending");
    expect(approvalMsg?.message?.role).toBe("tool");
    const content = approvalMsg?.message?.content;
    expect(Array.isArray(content)).toBe(true);
    expect((content as any[])?.[0]?.type).toBe("tool-approval-response");
    expect((content as any[])?.[0]?.approved).toBe(true);
  });
});

// Obsolete - new API doesn't look up by toolCallId
describe.skip("Multiple tool calls with same toolCallId", () => {
  test("finds first matching toolCallId regardless of which message has approval", async () => {
    const t = initConvexTest(schema);

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    // Second message has CORRECT and the approval request
    await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "duplicate-id",
              toolName: "testTool",
              input: { value: "CORRECT" },
              args: { value: "CORRECT" },
            },
            {
              type: "tool-approval-request",
              approvalId: "dup-approval",
              toolCallId: "duplicate-id",
            },
          ],
        },
      }),
    );

    // First message (older) has WRONG but no approval
    // Note: In real scenarios, duplicate toolCallIds shouldn't happen
    await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "duplicate-id", // Same ID!
              toolName: "testTool",
              input: { value: "WRONG" },
              args: { value: "WRONG" },
            },
          ],
        },
      }),
    );

    const toolInfo = await t.run(async (ctx) =>
      (testAgent as any)._findToolCallInfo(ctx, threadId, "dup-approval"),
    );

    // The code finds the first matching toolCallId in iteration order
    // Since messages are returned newest-first, it finds WRONG (newer message)
    // BUG: It should find the tool call in the same message as the approval request
    expect(toolInfo?.toolInput).toEqual({ value: "WRONG" });
  });
});

describe("Bug: UIMessage state not updated when approval comes after output", () => {
  test("final state depends on part order in messages array", () => {
    // If tool-result comes before tool-approval-response in the processing,
    // the final state might be incorrect
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
              toolCallId: "order-test",
              toolName: "testTool",
              input: { value: "test" },
              args: { value: "test" },
            },
            {
              type: "tool-approval-request",
              approvalId: "order-approval",
              toolCallId: "order-test",
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
            // Result comes first in the array
            {
              type: "tool-result",
              toolCallId: "order-test",
              toolName: "testTool",
              output: { type: "text", value: "done" },
            },
            // Approval response comes second
            {
              type: "tool-approval-response",
              approvalId: "order-approval",
              approved: true,
            },
          ],
        },
      },
    ];

    const uiMessages = toUIMessages(messages);
    const toolPart = uiMessages[0].parts.find(
      (p) => p.type === "tool-testTool",
    );

    // The state should be output-available since we have the result
    expect((toolPart as any).state).toBe("output-available");
    expect((toolPart as any).output).toBe("done");
  });
});

describe("Bug: Empty or malformed approval parts", () => {
  test("handles missing approvalId in request", () => {
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
              toolCallId: "no-approval-id",
              toolName: "testTool",
              input: { value: "test" },
              args: { value: "test" },
            },
            {
              type: "tool-approval-request",
              // Missing approvalId!
              toolCallId: "no-approval-id",
            } as any,
          ],
        },
      },
    ];

    // Should not throw, should handle gracefully
    const uiMessages = toUIMessages(messages);
    expect(uiMessages).toHaveLength(1);

    const toolPart = uiMessages[0].parts.find(
      (p) => p.type === "tool-testTool",
    );
    // State should be approval-requested but approval.id will be undefined
    expect((toolPart as any).state).toBe("approval-requested");
    expect((toolPart as any).approval?.id).toBeUndefined();
  });

  test("handles undefined approval response fields", () => {
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
              toolCallId: "undefined-fields",
              toolName: "testTool",
              input: { value: "test" },
              args: { value: "test" },
            },
            {
              type: "tool-approval-request",
              approvalId: "undef-approval",
              toolCallId: "undefined-fields",
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
              approvalId: "undef-approval",
              // Missing 'approved' field!
            } as any,
          ],
        },
      },
    ];

    const uiMessages = toUIMessages(messages);
    const toolPart = uiMessages[0].parts.find(
      (p) => p.type === "tool-testTool",
    );

    // BUG: If approved is undefined, what state should it be?
    // Currently it might be treated as falsy (denied)
    expect((toolPart as any).approval?.approved).toBeUndefined();
  });
});

describe("Bug: String content instead of array", () => {
  test("handles message with string content (no approval parts extracted)", () => {
    const messages: MessageDoc[] = [
      {
        _id: "msg1",
        _creationTime: Date.now(),
        order: 0,
        stepOrder: 0,
        status: "success",
        threadId: "thread1",
        tool: false,
        message: {
          role: "assistant",
          content: "This is just a string, not an array",
        },
        text: "This is just a string, not an array",
      },
    ];

    // Should handle gracefully without throwing
    const uiMessages = toUIMessages(messages);
    expect(uiMessages).toHaveLength(1);
    expect(uiMessages[0].text).toBe("This is just a string, not an array");
  });
});

describe("approveToolCall saves pending approval (no tool execution)", () => {
  test("approveToolCall saves approval without executing tool", async () => {
    const t = initConvexTest(schema);

    // Agent with a tool that would throw — but approveToolCall won't execute it
    const throwingAgent = new Agent(components.agent, {
      name: "throwing-agent",
      instructions: "Test",
      tools: {
        throwingTool: createTool({
          description: "Throws an error",
          inputSchema: z.object({}),
          needsApproval: () => true,
          execute: async (): Promise<string> => {
            throw new Error("Intentional test error");
          },
        }),
      },
      languageModel: mockModel(),
      stopWhen: stepCountIs(3),
    });

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    const { messageId: parentMessageId } = await t.run(async (ctx) =>
      throwingAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "throwing-call",
              toolName: "throwingTool",
              input: {},
              args: {},
            },
            {
              type: "tool-approval-request",
              approvalId: "throwing-approval",
              toolCallId: "throwing-call",
            },
          ],
        },
      }),
    );

    // approveToolCall no longer executes tools, so it should succeed
    // even for tools that would throw. The tool execution happens later
    // when the caller runs streamText/generateText.
    const result = await t.run(async (ctx) =>
      throwingAgent.approveToolCall(ctx as any, {
        threadId,
        toolCallId: "throwing-call",
        toolName: "throwingTool",
        args: {},
        parentMessageId,
        approvalId: "throwing-approval",
      }),
    );

    expect(result.messageId).toBeDefined();
  });
});

describe("Bug: Race condition with concurrent approvals", () => {
  test("documents TOCTOU issue - check and write are separate transactions", async () => {
    // This test documents a race condition caused by the action architecture:
    //
    // approveToolCall() is an ACTION that makes separate query/mutation calls:
    //   1. _findToolCallInfo() calls listMessages() → QUERY (transaction 1)
    //   2. saveMessage() → MUTATION (transaction 2)
    //
    // Race scenario:
    //   Action A: listMessages() → no response found     (query tx 1)
    //   Action B: listMessages() → no response found     (query tx 2)
    //   Action A: saveMessage() → saves response         (mutation tx 3)
    //   Action B: saveMessage() → DUPLICATE response!    (mutation tx 4)
    //
    // If this were a SINGLE MUTATION, Convex's serializable isolation would
    // prevent the race. But since it's an action with separate transactions,
    // the race exists.
    //
    // FIX: Move the check-and-write into a single mutation, or use
    // optimistic concurrency control (e.g., check approvalId uniqueness
    // via a unique index in the database).

    // We can't easily test this race condition in a unit test,
    // but we document it here as a known architectural limitation
    expect(true).toBe(true);
  });
});

// Obsolete - new API doesn't look up tool info
describe.skip("Bug: Approval for non-existent toolCallId", () => {
  test("returns null when toolCallId doesn't match any tool-call", async () => {
    const t = initConvexTest(schema);

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    // Approval request references a toolCallId that doesn't exist
    await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-approval-request",
              approvalId: "orphan-approval",
              toolCallId: "non-existent-call",
            },
          ],
        },
      }),
    );

    const toolInfo = await t.run(async (ctx) =>
      (testAgent as any)._findToolCallInfo(ctx, threadId, "orphan-approval"),
    );

    // Should return null because the referenced tool-call doesn't exist
    expect(toolInfo).toBeNull();
  });
});

// Obsolete - new API receives tool input directly from frontend
describe.skip("Bug: Tool input normalization", () => {
  test("handles tool call with only 'args' and no 'input'", async () => {
    const t = initConvexTest(schema);

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    // Some older messages might only have 'args' not 'input'
    await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "args-only-call",
              toolName: "testTool",
              args: { value: "from-args" },
              // No 'input' field!
            },
            {
              type: "tool-approval-request",
              approvalId: "args-only-approval",
              toolCallId: "args-only-call",
            },
          ],
        },
      }),
    );

    const toolInfo = await t.run(async (ctx) =>
      (testAgent as any)._findToolCallInfo(ctx, threadId, "args-only-approval"),
    );

    // Should fallback to 'args' when 'input' is undefined
    expect(toolInfo?.toolInput).toEqual({ value: "from-args" });
  });

  test("handles tool call with neither 'args' nor 'input'", async () => {
    const t = initConvexTest(schema);

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    // Tool call with no input at all
    await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "no-input-call",
              toolName: "testTool",
              input: undefined, // Explicitly undefined to test fallback
              args: undefined,
            } as any, // Cast to any since we're testing edge case with missing fields
            {
              type: "tool-approval-request",
              approvalId: "no-input-approval",
              toolCallId: "no-input-call",
            },
          ],
        },
      }),
    );

    const toolInfo = await t.run(async (ctx) =>
      (testAgent as any)._findToolCallInfo(ctx, threadId, "no-input-approval"),
    );

    // Should fallback to empty object
    expect(toolInfo?.toolInput).toEqual({});
  });
});

describe("Content merge in addMessages", () => {
  test("merges pending approval content with subsequent tool result", async () => {
    const t = initConvexTest(schema);

    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "user1" }),
    );

    // Save the assistant message with a tool call + approval request
    const { messageId: assistantMsgId } = await t.run(async (ctx) =>
      testAgent.saveMessage(ctx, {
        threadId,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "merge-call",
              toolName: "testTool",
              input: { value: "merge-test" },
              args: { value: "merge-test" },
            },
            {
              type: "tool-approval-request",
              approvalId: "merge-approval",
              toolCallId: "merge-call",
            },
          ],
        },
      }),
    );

    // Approve the tool call — saves as pending with approval content
    const { messageId: approvalMsgId } = await t.run(async (ctx) =>
      testAgent.approveToolCall(ctx as any, {
        threadId,
        toolCallId: "merge-call",
        toolName: "testTool",
        args: { value: "merge-test" },
        parentMessageId: assistantMsgId,
        approvalId: "merge-approval",
      }),
    );

    // Verify the pending message has approval content
    const pendingMessages = await t.run(async (ctx) => {
      const res = await testAgent.listMessages(ctx, {
        threadId,
        paginationOpts: { cursor: null, numItems: 10 },
        statuses: ["pending"],
      });
      return res.page;
    });
    const pendingMsg = pendingMessages.find((m) => m._id === approvalMsgId);
    expect(pendingMsg).toBeDefined();
    expect(pendingMsg?.status).toBe("pending");
    const pendingContent = pendingMsg?.message?.content;
    expect(Array.isArray(pendingContent)).toBe(true);
    expect((pendingContent as any[])?.[0]?.type).toBe(
      "tool-approval-response",
    );

    // Now simulate what happens when addMessages replaces the pending message
    // with a tool result (as streamText would do). The approval-response
    // content should be preserved (merged/prepended).
    await t.run(async (ctx) =>
      testAgent.saveMessages(ctx, {
        threadId,
        promptMessageId: assistantMsgId,
        pendingMessageId: approvalMsgId,
        messages: [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "merge-call",
                toolName: "testTool",
                output: { type: "text", value: "Result: merge-test" },
              },
            ],
          },
        ],
        skipEmbeddings: true,
      }),
    );

    // Fetch the message that replaced the pending one
    const allMessages = await t.run(async (ctx) => {
      const res = await testAgent.listMessages(ctx, {
        threadId,
        paginationOpts: { cursor: null, numItems: 20 },
      });
      return res.page;
    });

    const mergedMsg = allMessages.find((m) => m._id === approvalMsgId);
    expect(mergedMsg).toBeDefined();
    expect(mergedMsg?.status).toBe("success");
    const mergedContent = mergedMsg?.message?.content;
    expect(Array.isArray(mergedContent)).toBe(true);

    // Should have both the approval-response (prepended) and tool-result
    const contentArr = mergedContent as any[];
    expect(contentArr.length).toBe(2);
    expect(contentArr[0].type).toBe("tool-approval-response");
    expect(contentArr[0].approved).toBe(true);
    expect(contentArr[1].type).toBe("tool-result");
    expect(contentArr[1].toolName).toBe("testTool");
  });
});
