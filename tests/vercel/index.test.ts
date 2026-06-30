import { describe, expect, test } from "vitest";
import { Output, simulateReadableStream, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { defineTool, type AgentRun } from "../../src/client/index.js";
import { v } from "convex/values";
import type {
  AgentMessageDoc,
  AgentMessageInput,
  AgentRunEvent,
} from "../../src/validators.js";
import { defineModel } from "../../src/vercel/index.js";
import {
  fromVercelMessage,
  toVercelMessage,
} from "../../src/vercel/messages.js";
import {
  toVercelUIMessageStream,
} from "../../src/vercel/streams.js";
import type { AgentRunEventItem } from "../../src/client/runEvents.js";

async function readChunks(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return chunks;
    }
    chunks.push(value);
  }
}

async function collectEvents(events: AsyncIterable<AgentRunEvent>) {
  const collected: AgentRunEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

const run: AgentRun = {
  runId: "run-1",
  threadId: "thread-1",
  agentName: "Support Agent",
  streamId: "stream-1",
  status: "running",
  createdAt: 0,
  updatedAt: 0,
};

const message: AgentMessageDoc = {
  _id: "message-1",
  _creationTime: 0,
  threadId: "thread-1",
  order: 0,
  stepOrder: 0,
  status: "success",
  tool: false,
  message: {
    author: { type: "user", userId: "user-1" },
    content: [{ type: "text", text: "Hello" }],
  },
};

describe("@convex-dev/agent/vercel", () => {
  test("adapts AI SDK streamText output into Agent run events", async () => {
    const aiModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Hello" },
            { type: "text-end", id: "text-1" },
            { type: "reasoning-start", id: "reasoning-1" },
            { type: "reasoning-delta", id: "reasoning-1", delta: "Greet." },
            { type: "reasoning-end", id: "reasoning-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 4,
                  noCache: 3,
                  cacheRead: 1,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 6,
                  text: 5,
                  reasoning: 1,
                },
              },
            },
          ],
        }),
      }),
    });

    const agentModel = defineModel({
      model: aiModel,
      instructions: "You are a support agent.",
      temperature: 0,
    });
    const events = await collectEvents(
      agentModel.execute({
        run,
        messages: [message],
        context: [{ type: "text", name: "account", text: "Plan: Pro" }],
      }),
    );

    expect(events).toEqual([
      { type: "text.delta", text: "Hello" },
      { type: "reasoning.delta", text: "Greet." },
      {
        type: "done",
        usage: {
          inputTokens: 4,
          outputTokens: 6,
          totalTokens: 10,
          tokenDetails: {
            input: { noCacheTokens: 3, cacheReadTokens: 1 },
            output: { textTokens: 5, reasoningTokens: 1 },
          },
        },
      },
    ]);
    expect(aiModel.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(aiModel.doStreamCalls[0].prompt)).toContain("Hello");
    expect(JSON.stringify(aiModel.doStreamCalls[0].prompt)).toContain(
      "Plan: Pro",
    );
  });

  test("emits Agent output events for AI SDK structured output", async () => {
    const aiModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            {
              type: "text-delta",
              id: "text-1",
              delta: '{"category":"support","confidence":0.9}',
            },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 2,
                  noCache: 2,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 5,
                  text: 5,
                  reasoning: undefined,
                },
              },
            },
          ],
        }),
      }),
    });
    const agentModel = defineModel({
      model: aiModel,
      output: Output.json(),
    });

    const events = await collectEvents(
      agentModel.execute({ run, messages: [message], context: [] }),
    );

    expect(events.at(-1)).toEqual({
      type: "output",
      value: { category: "support", confidence: 0.9 },
    });
  });

  test("passes Agent tool schemas to AI SDK without moving execution into the adapter", async () => {
    let executed = false;
    const refundPayment = defineTool({
      description: "Refund a customer payment.",
      input: v.object({
        paymentId: v.string(),
        amount: v.number(),
      }),
      needsApproval: true,
      execute: async (input) => {
        executed = true;
        return { refunded: input.paymentId };
      },
    });
    const aiModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 1,
                  text: 1,
                  reasoning: undefined,
                },
              },
            },
          ],
        }),
      }),
    });
    const agentModel = defineModel({ model: aiModel });

    await collectEvents(
      agentModel.execute({
        run,
        messages: [message],
        context: [],
        tools: { refundPayment },
      }),
    );

    expect(executed).toBe(false);
    expect(aiModel.doStreamCalls[0].tools).toEqual([
      {
        type: "function",
        name: "refundPayment",
        description: "Refund a customer payment.",
        inputSchema: {
          type: "object",
          properties: {
            paymentId: { type: "string" },
            amount: { type: "number" },
          },
          required: ["paymentId", "amount"],
          additionalProperties: false,
        },
      },
    ]);
  });

  test("converts Agent messages to Vercel UI messages", () => {
    const message: AgentMessageInput = {
      clientKey: "client-1",
      message: {
        author: { type: "agent", name: "Support Agent" },
        content: [
          { type: "text", text: "Hello" },
          { type: "reasoning", text: "Because the user asked." },
          {
            type: "source",
            sourceType: "url",
            id: "docs",
            url: "https://docs.convex.dev",
            title: "Docs",
          },
        ],
      },
    };

    const uiMessage = toVercelMessage(message, { runId: "run-1" });

    expect(uiMessage).toMatchObject({
      id: "client-1",
      role: "assistant",
      metadata: { agent: { runId: "run-1" } },
      parts: [
        { type: "text", text: "Hello", state: "done" },
        {
          type: "reasoning",
          text: "Because the user asked.",
          state: "done",
        },
        {
          type: "source-url",
          sourceId: "docs",
          url: "https://docs.convex.dev",
          title: "Docs",
        },
      ],
    });
  });

  test("converts Vercel UI messages to Agent messages", () => {
    const agentMessage = fromVercelMessage(
      {
        id: "message-1",
        role: "user",
        parts: [
          { type: "text", text: "Refund order 123" },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "receipt.txt",
            url: "https://example.com/receipt.txt",
          },
        ],
      },
      { userId: "user-1" },
    );

    expect(agentMessage).toEqual({
      clientKey: "message-1",
      message: {
        author: { type: "user", userId: "user-1" },
        content: [
          { type: "text", text: "Refund order 123" },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "receipt.txt",
            url: "https://example.com/receipt.txt",
          },
        ],
      },
    });
  });

  test("preserves Agent-only message parts as Vercel data parts", () => {
    const message: AgentMessageInput = {
      clientKey: "client-2",
      message: {
        author: { type: "agent", name: "Support Agent" },
        content: [
          {
            type: "file",
            fileId: "file-1",
            mediaType: "application/pdf",
            filename: "invoice.pdf",
          },
          {
            type: "approval-request",
            approvalId: "approval-1",
            toolCallId: "tool-1",
          },
          {
            type: "approval-response",
            approvalId: "approval-1",
            toolCallId: "tool-1",
            approved: false,
            reason: "Manager review required.",
          },
        ],
      },
    };

    const uiMessage = toVercelMessage(message);
    expect(uiMessage.parts).toEqual([
      {
        type: "data-agent-file",
        id: "file-1",
        data: {
          type: "file",
          fileId: "file-1",
          mediaType: "application/pdf",
          filename: "invoice.pdf",
        },
      },
      {
        type: "data-agent-approval-request",
        id: "approval-1",
        data: {
          type: "approval-request",
          approvalId: "approval-1",
          toolCallId: "tool-1",
        },
      },
      {
        type: "data-agent-approval-response",
        id: "approval-1",
        data: {
          type: "approval-response",
          approvalId: "approval-1",
          toolCallId: "tool-1",
          approved: false,
          reason: "Manager review required.",
        },
      },
    ]);

    expect(fromVercelMessage(uiMessage).message.content).toEqual(
      message.message.content,
    );
  });

  test("converts Agent run events to AI SDK UI message chunks", async () => {
    const events: AgentRunEventItem[] = [
      {
        index: 0,
        sequence: 0,
        event: { type: "text.delta", text: "Hello " },
      },
      {
        index: 1,
        sequence: 1,
        event: { type: "text.delta", text: "there" },
      },
      {
        index: 2,
        sequence: 2,
        event: { type: "reasoning.delta", text: "Greeting." },
      },
      {
        index: 3,
        sequence: 3,
        event: {
          type: "tool.call",
          toolCallId: "tool-1",
          name: "lookup",
          input: { accountId: "acct_1" },
        },
      },
      {
        index: 4,
        sequence: 4,
        event: {
          type: "tool.result",
          toolCallId: "tool-1",
          output: { ok: true },
        },
      },
      {
        index: 5,
        sequence: 5,
        event: {
          type: "done",
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
            tokenDetails: { input: { cached: 3 }, output: { reasoning: 1 } },
          },
        },
      },
    ];

    const chunks = await readChunks(
      toVercelUIMessageStream(events, { messageId: "message-1" }),
    );

    expect(chunks).toEqual([
      { type: "start", messageId: "message-1", messageMetadata: undefined },
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", delta: "Hello " },
      { type: "text-delta", id: "text-0", delta: "there" },
      { type: "text-end", id: "text-0" },
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "Greeting." },
      { type: "reasoning-end", id: "reasoning-0" },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "lookup",
        input: { accountId: "acct_1" },
        dynamic: true,
      },
      {
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: { ok: true },
        dynamic: true,
      },
      {
        type: "message-metadata",
        messageMetadata: {
          agent: {
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
              tokenDetails: {
                input: { cached: 3 },
                output: { reasoning: 1 },
              },
            },
          },
        },
      },
      {
        type: "finish",
        finishReason: "stop",
        messageMetadata: {
          agent: {
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
              tokenDetails: {
                input: { cached: 3 },
                output: { reasoning: 1 },
              },
            },
          },
        },
      },
    ]);
  });
});
