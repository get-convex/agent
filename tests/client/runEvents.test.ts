import { describe, expect, test } from "vitest";
import {
  createAgentRunState,
  handleAgentRunStream,
  type AgentRunEventItem,
} from "../../src/client/index.js";

function item(index: number, event: AgentRunEventItem["event"]): AgentRunEventItem {
  return { index, sequence: index, event };
}

describe("Agent run event state", () => {
  test("materializes text, reasoning, data, output, usage, and done events", () => {
    const state = createAgentRunState();

    state.addAll([
      item(0, { type: "text.delta", text: "hello" }),
      item(1, { type: "text.delta", text: " world" }),
      item(2, { type: "reasoning.delta", text: "thinking" }),
      item(3, { type: "data", name: "progress", value: { stage: "read" } }),
      item(4, { type: "output", value: { ok: true } }),
      item(5, {
        type: "usage",
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          tokenDetails: {
            input: { cachedTokens: 1 },
            output: { reasoningTokens: 2 },
          },
        },
      }),
      item(6, { type: "done" }),
    ]);

    expect(state.value.text).toBe("hello world");
    expect(state.value.reasoning).toBe("thinking");
    expect(state.value.data.progress).toEqual([{ stage: "read" }]);
    expect(state.value.output).toEqual({ ok: true });
    expect(state.value.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      tokenDetails: {
        input: { cachedTokens: 1 },
        output: { reasoningTokens: 2 },
      },
    });
    expect(state.value.status).toBe("success");
    expect(state.value.done).toBe(true);
    expect(state.value.lastIndex).toBe(6);
  });

  test("explicit status updates do not invent event progress", () => {
    const state = createAgentRunState();

    state.setStatus("pending");
    expect(state.value.status).toBe("pending");

    state.setStatus("waiting");
    expect(state.value.status).toBe("waiting");
  });

  test("reconstructs tool approval state and ignores duplicate indexes", () => {
    const state = createAgentRunState([
      item(0, {
        type: "tool.call",
        toolCallId: "call-1",
        name: "refund",
        input: { paymentId: "pay_123" },
      }),
      item(1, {
        type: "approval.request",
        approvalId: "approval:call-1",
        toolCallId: "call-1",
        name: "refund",
        input: { paymentId: "pay_123" },
      }),
    ]);

    state.add(
      item(1, {
        type: "approval.request",
        approvalId: "approval:call-1",
        toolCallId: "call-1",
        name: "refund",
        input: { paymentId: "duplicate" },
      }),
    );

    expect(state.value.toolCalls).toMatchObject([
      {
        toolCallId: "call-1",
        name: "refund",
        input: { paymentId: "pay_123" },
        status: "waiting",
        approvalId: "approval:call-1",
      },
    ]);
    expect(state.value.approvals).toHaveLength(1);
    expect(state.value.status).toBe("waiting");
    expect(state.value.content).toHaveLength(2);

    state.add(
      item(2, {
        type: "approval.response",
        approvalId: "approval:call-1",
        toolCallId: "call-1",
        approved: true,
      }),
    );
    state.add(
      item(3, {
        type: "tool.result",
        toolCallId: "call-1",
        name: "refund",
        output: { refunded: true },
      }),
    );

    expect(state.value.toolCalls).toMatchObject([
      {
        status: "success",
        approved: true,
        output: { refunded: true },
      },
    ]);
    expect(state.value.approvals).toHaveLength(0);
    expect(state.value.status).toBe("running");
  });

  test("final message replaces streamed draft text", () => {
    const state = createAgentRunState([
      item(0, { type: "text.delta", text: "draft" }),
      item(1, {
        type: "message",
        message: {
          message: {
            author: { type: "agent", name: "assistant" },
            content: [{ type: "text", text: "final" }],
          },
        },
      }),
    ]);

    expect(state.value.text).toBe("final");
    expect(state.value.content).toEqual([{ type: "text", text: "final" }]);
    expect(state.value.messages).toHaveLength(1);
  });

  test("rejects out-of-order and gapped event pages", () => {
    expect(() =>
      createAgentRunState([
        item(2, { type: "text.delta", text: "late" }),
        item(1, { type: "text.delta", text: "early" }),
      ]),
    ).toThrow(/out of order|gap/);

    const state = createAgentRunState([
      item(0, { type: "text.delta", text: "first" }),
    ]);

    expect(() =>
      state.add(item(2, { type: "text.delta", text: "gap" })),
    ).toThrow(/expected index 1/);
  });

  test("duplicate replay is a state no-op", () => {
    const state = createAgentRunState([
      item(0, { type: "text.delta", text: "once" }),
    ]);
    const before = state.value;

    const after = state.add(item(0, { type: "text.delta", text: "twice" }));

    expect(after).toBe(before);
    expect(after.text).toBe("once");
  });

  test("partial tool state does not invent unknown tool metadata", () => {
    const state = createAgentRunState([
      item(3, {
        type: "tool.result",
        toolCallId: "call-late",
        output: { ok: true },
      }),
    ]);

    expect(state.value.toolCalls).toMatchObject([
      {
        toolCallId: "call-late",
        status: "success",
        partial: true,
        requestedAt: 3,
        resolvedAt: 3,
      },
    ]);
    expect(state.value.toolCalls[0].name).toBeUndefined();
    expect(state.value.toolCalls[0].input).toBeUndefined();
  });

  test("reset replaces prior state", () => {
    const state = createAgentRunState([
      item(0, { type: "text.delta", text: "old" }),
    ]);

    state.reset([item(0, { type: "text.delta", text: "new" })]);

    expect(state.value.text).toBe("new");
    expect(state.value.content).toEqual([{ type: "text", text: "new" }]);
  });

  test("handles Agent HTTP streams by run id", async () => {
    const calls: string[] = [];
    const events: AgentRunEventItem[] = [];
    const statuses: Array<{ status: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      calls.push(input.toString());
      return new Response(
        [
          "id: cursor-0",
          "event: event",
          'data: {"index":0,"sequence":0,"event":{"type":"text.delta","text":"hi"}}',
          "",
          "event: done",
          'data: {"status":"success"}',
          "",
          "",
        ].join("\n"),
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }) as typeof fetch;

    try {
      const connection = handleAgentRunStream({
        url: "https://agent.test/run?existing=1",
        runId: "run-123",
        onEvents: (next) => events.push(...next),
        onStatus: (status) => statuses.push(status),
      });
      await connection.closed;
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual(["https://agent.test/run?existing=1&runId=run-123"]);
    expect(events).toEqual([item(0, { type: "text.delta", text: "hi" })]);
    expect(statuses).toEqual([{ status: "success" }]);
  });
});
