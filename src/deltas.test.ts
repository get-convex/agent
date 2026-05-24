import { describe, it, expect } from "vitest";
import {
  applyUIMessageChunksIncremental,
  blankUIMessage,
  deriveUIMessagesFromTextStreamParts,
  emptyIncrementalStreamState,
  getParts,
  updateFromTextStreamParts,
  updateFromUIMessageChunks,
} from "./deltas.js";
import type { StreamMessage, StreamDelta } from "./validators.js";
import { omit } from "convex-helpers";
import type { Tool, ToolUIPart, TypedToolResult, UIMessageChunk } from "ai";

describe("UIMessageChunks", () => {
  it("updates a UIMessage with a tool call and follow up", async () => {
    const uiMessage = blankUIMessage(
      {
        streamId: "s1",
        status: "streaming",
        order: 0,
        stepOrder: 1,
        format: "UIMessageChunk",
        agentName: "agent1",
      },
      "thread1",
    );
    expect(uiMessage.text).toBe("");
    expect(uiMessage.parts).toEqual([]);
    const updatedMessage = await updateFromUIMessageChunks(uiMessage, [
      { type: "start" },
      { type: "start-step" },
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "Okay" },
      {
        type: "reasoning-delta",
        id: "reasoning-0",
        delta: ", the user is asking...",
      },
      { type: "text-start", id: "txt-1" },
      {
        type: "text-delta",
        id: "txt-1",
        delta: "Hey ho.",
      },
      { type: "reasoning-end", id: "reasoning-0" },
      { type: "text-end", id: "txt-1" },
      { type: "tool-input-start", toolCallId: "0ychh9k6f", toolName: "say" },
      {
        type: "tool-input-delta",
        toolCallId: "0ychh9k6f",
        inputTextDelta:
          '{"question":"What is your favorite flavor of ice cream?"}',
      },
      {
        type: "tool-input-available",
        toolCallId: "0ychh9k6f",
        toolName: "say",
        input: { question: "What is your favorite flavor of ice cream?" },
        providerMetadata: { openai: { itemId: "123" } },
      },
      {
        type: "tool-output-available",
        toolCallId: "0ychh9k6f",
        output: "I'm sorry I can't help you. Stop asking me questions.",
      },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "tool-input-start", toolCallId: "1ychh9k6f", toolName: "say" },
      {
        type: "tool-input-delta",
        toolCallId: "1ychh9k6f",
        inputTextDelta:
          '{"question":"What is your favorite flavor of ice cream?"}',
      },
      {
        type: "tool-input-available",
        toolCallId: "1ychh9k6f",
        toolName: "say",
        input: { question: "What is your favorite flavor of ice cream?" },
      },
      {
        type: "tool-output-available",
        toolCallId: "1ychh9k6f",
        output: "I'm serious.",
      },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "text-start", id: "msg_0" },
      {
        type: "text-delta",
        id: "msg_0",
        delta: "The best ice cream flavor is vanilla",
      },
      {
        type: "text-delta",
        id: "msg_0",
        delta: ".",
      },
      { type: "text-end", id: "msg_0" },
      { type: "finish-step" },
      { type: "finish" },
    ]);
    expect(updatedMessage.text).toBe(
      "Hey ho. The best ice cream flavor is vanilla.",
    );
    const expectedParts = [
      {
        type: "step-start",
      },
      {
        state: "done",
        text: "Okay, the user is asking...",
        type: "reasoning",
      },
      {
        state: "done",
        text: "Hey ho.",
        type: "text",
      },
      {
        callProviderMetadata: {
          openai: {
            itemId: "123",
          },
        },
        input: {
          question: "What is your favorite flavor of ice cream?",
        },
        output: "I'm sorry I can't help you. Stop asking me questions.",

        state: "output-available",
        toolCallId: "0ychh9k6f",
        type: "tool-say",
      },
      {
        type: "step-start",
      },
      {
        input: {
          question: "What is your favorite flavor of ice cream?",
        },
        output: "I'm serious.",
        state: "output-available",
        toolCallId: "1ychh9k6f",
        type: "tool-say",
      },
      {
        type: "step-start",
      },
      {
        state: "done",
        text: "The best ice cream flavor is vanilla.",
        type: "text",
      },
    ];
    expect(updatedMessage.parts).toEqual(expectedParts);
    expect(updatedMessage.parts).toHaveLength(8);
  });
});

describe("UIMessageChunks - continuation stream", () => {
  it("gracefully handles tool-result without tool-call in continuation stream after approval", async () => {
    // This simulates what happens after tool approval:
    // Stream A: tool-call, tool-approval-request -> finishes
    // User approves
    // Stream B: tool-result (referencing tool-call from Stream A) -> this test
    //
    // The AI SDK's readUIMessageStream expects tool-call before tool-result,
    // but they're in different streams. The onError handler should gracefully
    // ignore this error since stored messages provide the fallback.
    const uiMessage = blankUIMessage(
      {
        streamId: "continuation-stream",
        status: "streaming",
        order: 1,
        stepOrder: 0,
        format: "UIMessageChunk",
        agentName: "agent1",
      },
      "thread1",
    );

    // Send a tool-result without the corresponding tool-call in this stream
    // This would normally throw "No tool invocation found" error
    const updatedMessage = await updateFromUIMessageChunks(uiMessage, [
      { type: "start" },
      { type: "start-step" },
      {
        type: "tool-output-available",
        toolCallId: "call_from_previous_stream",
        output: "Tool execution result",
      },
      { type: "finish-step" },
      { type: "finish" },
    ]);

    // The message should NOT be marked as failed - the error should be suppressed
    expect(updatedMessage.status).not.toBe("failed");
    // The stream still processes (even if tool-output isn't reflected without tool-input)
    expect(updatedMessage).toBeDefined();
  });
});

describe("mergeDeltas", () => {
  it("merges a single text-delta into a message", () => {
    const streamId = "s1";
    const deltas = [
      {
        streamId,
        start: 0,
        end: 5,
        parts: [{ type: "text-delta", id: "1", text: "Hello" }],
      } satisfies StreamDelta,
    ];
    const [messages, newStreams, changed] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      [{ streamId, order: 1, stepOrder: 0, status: "streaming" }],
      [],
      deltas,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Hello");
    expect(messages[0].role).toBe("assistant");
    expect(changed).toBe(true);
    expect(newStreams[0].cursor).toBe(5);
  });

  it("merges multiple deltas for the same stream", () => {
    const streamId = "s1";
    const deltas = [
      {
        streamId,
        start: 0,
        end: 5,
        parts: [{ type: "text-delta", id: "1", text: "Hello" }],
      },
      {
        streamId,
        start: 5,
        end: 11,
        parts: [{ type: "text-delta", id: "2", text: " World!" }],
      },
    ];
    const [messages, newStreams, changed] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      [{ streamId, order: 1, stepOrder: 0, status: "streaming" }],
      [],
      deltas,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Hello World!");
    expect(changed).toBe(true);
    expect(newStreams[0].cursor).toBe(11);
  });

  it("handles tool-call and tool-result parts", () => {
    const streamId = "s2";
    const deltas = [
      {
        streamId,
        start: 0,
        end: 1,
        parts: [
          {
            type: "tool-call",
            toolCallId: "call1",
            toolName: "myTool",
            input: "What's the meaning of life?",
          },
        ],
      } satisfies StreamDelta,
      {
        streamId,
        start: 1,
        end: 2,
        parts: [
          {
            type: "tool-result",
            toolCallId: "call1",
            toolName: "myTool",
            input: undefined,
            output: "42",
          } satisfies TypedToolResult<{ myTool: Tool }>,
        ],
      } satisfies StreamDelta,
    ];
    const [[message], _, changed] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      [{ streamId, order: 2, stepOrder: 0, status: "streaming" }],
      [],
      deltas,
    );
    expect(message).toBeDefined();
    expect(message.role).toBe("assistant");
    const content = message.parts;
    expect(content).toEqual([
      {
        type: "tool-myTool",
        toolCallId: "call1",
        input: "What's the meaning of life?",
        output: "42",
        state: "output-available",
      } satisfies ToolUIPart,
    ]);
    expect(changed).toBe(true);
  });

  it("returns changed=false if no new deltas", () => {
    const streamId = "s3";
    const deltas: StreamDelta[] = [];
    const [, newStreams, changed] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      [{ streamId, order: 3, stepOrder: 0, status: "streaming" }],
      [],
      deltas,
    );
    expect(changed).toBe(false);
    expect(newStreams[0].cursor).toBe(0);
  });

  it("handles multiple streams and sorts by order/stepOrder", () => {
    const deltas = [
      {
        streamId: "s2",
        start: 0,
        end: 3,
        parts: [{ type: "text-delta", id: "1", text: "B" }],
      } satisfies StreamDelta,
      {
        streamId: "s1",
        start: 0,
        end: 3,
        parts: [{ type: "text-delta", id: "2", text: "A" }],
      } satisfies StreamDelta,
    ];
    const [messages, _, changed] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      [
        { streamId: "s1", order: 1, stepOrder: 0, status: "streaming" },
        { streamId: "s2", order: 2, stepOrder: 0, status: "streaming" },
      ],
      [],
      deltas,
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("A");
    expect(messages[1].text).toBe("B");
    expect(changed).toBe(true);
    // Sorted by order
    expect(messages[0].order).toBe(1);
    expect(messages[1].order).toBe(2);
  });

  it("does not duplicate text content when merging sequential text-deltas", () => {
    const streamId = "s4";
    const deltas = [
      {
        streamId,
        start: 0,
        end: 5,
        parts: [{ type: "text-delta", id: "1", text: "Hello" }],
      },
      {
        streamId,
        start: 5,
        end: 11,
        parts: [{ type: "text-delta", id: "2", text: " World!" }],
      },
      {
        streamId,
        start: 11,
        end: 12,
        parts: [{ type: "text-delta", id: "3", text: "!" }],
      },
    ] satisfies StreamDelta[];
    const [messages] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      [{ streamId, order: 4, stepOrder: 0, status: "streaming" }],
      [],
      deltas,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Hello World!!");
    // There should only be one text part per message
    const content = messages[0].parts;
    if (Array.isArray(content)) {
      const textParts = content.filter((p) => p.type === "text");
      expect(textParts).toHaveLength(1);
      expect(textParts[0].text).toBe("Hello World!!");
    }
  });

  it("does not duplicate reasoning parts", () => {
    const streamId = "s6";
    const deltas = [
      {
        streamId,
        start: 0,
        end: 1,
        parts: [
          { type: "reasoning-start", id: "1" },
          { type: "reasoning-delta", id: "1", text: "I'm thinking..." },
        ],
      },
      {
        streamId,
        start: 1,
        end: 2,
        parts: [
          { type: "reasoning-delta", id: "1", text: " Still thinking..." },
        ],
      },
      {
        streamId,
        start: 2,
        end: 3,
        parts: [{ type: "reasoning-end", id: "1" }],
      },
    ];
    const [messages] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      [{ streamId, order: 6, stepOrder: 0, status: "streaming" }],
      [],
      deltas,
    );
    expect(messages).toHaveLength(1);
    if (Array.isArray(messages[0].parts)) {
      const reasoningParts = messages[0].parts.filter(
        (p) => p.type === "reasoning",
      );
      expect(reasoningParts).toHaveLength(1);
      expect(reasoningParts[0].text).toBe("I'm thinking... Still thinking...");
      expect(reasoningParts[0].state).toBe("done");
    }
  });

  it("applyDeltasToStreamMessage is idempotent and does not duplicate content", () => {
    const streamId = "s7";
    const streamMessage = {
      streamId,
      order: 7,
      stepOrder: 0,
      status: "streaming",
    } satisfies StreamMessage;
    const deltas = [
      {
        streamId,
        start: 0,
        end: 5,
        parts: [{ type: "text-delta", id: "1", text: "Hello" }],
      },
      {
        streamId,
        start: 5,
        end: 11,
        parts: [{ type: "text-delta", id: "2", text: " World!" }],
      },
    ];
    // First call: apply both deltas
    let [result, changed] = updateFromTextStreamParts(
      "thread1",
      streamMessage,
      undefined,
      deltas,
    );
    expect(result.message.text).toBe("Hello World!");
    // Second call: re-apply the same deltas (should not duplicate)
    [result, changed] = updateFromTextStreamParts(
      "thread1",
      streamMessage,
      result,
      deltas,
    );
    expect(result.message.text).toBe("Hello World!");
    // Third call: add a new delta
    const moreDeltas = [
      ...deltas,
      {
        streamId,
        start: 11,
        end: 12,
        parts: [{ type: "text-delta", id: "3", text: "!" }],
      },
    ];
    [result, changed] = updateFromTextStreamParts(
      "thread1",
      streamMessage,
      result,
      moreDeltas,
    );
    expect(changed).toBe(true);
    expect(result.message.text).toBe("Hello World!!");
    // Re-apply all deltas again (should still not duplicate)
    [result, changed] = updateFromTextStreamParts(
      "thread1",
      streamMessage,
      result,
      moreDeltas,
    );
    expect(changed).toBe(false);
    expect(result.message.text).toBe("Hello World!!");
  });

  it("mergeDeltas is pure and does not mutate inputs", () => {
    const streamId = "s8";
    const streamMessages = [
      { streamId, order: 8, stepOrder: 0, status: "streaming" },
    ] satisfies StreamMessage[];
    const deltas = [
      {
        streamId,
        start: 0,
        end: 5,
        parts: [{ type: "text-delta", id: "1", text: "Hello" }],
      },
      {
        streamId,
        start: 5,
        end: 11,
        parts: [{ type: "text-delta", id: "2", text: " World!" }],
      },
    ];
    // Deep freeze inputs to catch mutation
    function deepFreeze(obj: unknown): unknown {
      if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        for (const key of Object.keys(obj)) {
          deepFreeze((obj as Record<string, unknown>)[key]);
        }
      }
      return obj;
    }
    deepFreeze(streamMessages);
    deepFreeze(deltas);
    const [messages1, streams1, changed1] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      streamMessages,
      [],
      deltas,
    );
    const [messages2, streams2, changed2] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      streamMessages,
      [],
      deltas,
    );
    expect(messages1.map((m) => omit(m, ["_creationTime"]))).toEqual(
      messages2.map((m) => omit(m, ["_creationTime"])),
    );
    expect(
      streams1.map((s) => ({
        ...s,
        message: omit(s.message, ["_creationTime"]),
      })),
    ).toEqual(
      streams2.map((s) => ({
        ...s,
        message: omit(s.message, ["_creationTime"]),
      })),
    );
    expect(changed1).toBe(changed2);
    // Inputs should remain unchanged
    expect(streamMessages).toMatchObject([
      { streamId, order: 8, stepOrder: 0, status: "streaming" },
    ]);
    expect(deltas).toEqual([
      {
        streamId,
        start: 0,
        end: 5,
        parts: [{ type: "text-delta", id: "1", text: "Hello" }],
      },
      {
        streamId,
        start: 5,
        end: 11,
        parts: [{ type: "text-delta", id: "2", text: " World!" }],
      },
    ]);
  });

  it("incremental processing of tool-input-delta chunks is O(N) not O(N²)", async () => {
    const N = 500;
    const streamId = "s-perf";
    const toolCallId = "tool-0";
    const streamMessage = {
      streamId,
      status: "streaming" as const,
      order: 0,
      stepOrder: 0,
      format: "UIMessageChunk" as const,
      agentName: "agent1",
    };

    // One StreamDelta with preamble, then N deltas each with one tool-input-delta
    const allDeltas: StreamDelta[] = [
      {
        streamId,
        start: 0,
        end: 1,
        parts: [
          { type: "start" },
          { type: "start-step" },
          { type: "tool-input-start", toolCallId, toolName: "myTool" },
        ] as UIMessageChunk[],
      },
      ...Array.from({ length: N }, (_, i) => ({
        streamId,
        start: i + 1,
        end: i + 2,
        parts: [
          {
            type: "tool-input-delta",
            toolCallId,
            inputTextDelta: "x",
          } as UIMessageChunk,
        ],
      })),
    ];

    // Simulate the hook: process one delta at a time, tracking cursor + prior message
    let cursor = 0;
    let uiMessage = blankUIMessage(streamMessage, "thread-perf");
    let streamState = emptyIncrementalStreamState();
    let totalPartsProcessed = 0;

    for (let i = 0; i <= N; i++) {
      const available = allDeltas.slice(0, i + 1);
      const { parts: newParts, cursor: newCursor } = getParts<UIMessageChunk>(
        available,
        cursor,
      );
      if (newParts.length > 0) {
        totalPartsProcessed += newParts.length;
        ({ message: uiMessage, streamState } =
          await applyUIMessageChunksIncremental(
            structuredClone(uiMessage),
            newParts,
            streamState,
          ));
        cursor = newCursor;
      }
    }

    // O(N): each delta part processed exactly once (N tool-input-deltas + 3 preamble parts)
    expect(totalPartsProcessed).toBe(N + 3);

    // Correctness: the raw accumulator holds "x" repeated N times across batches
    expect(streamState.toolInputText[toolCallId]).toBe("x".repeat(N));
    const toolPart = uiMessage.parts.find(
      (p): p is ToolUIPart => "toolCallId" in p && p.toolCallId === toolCallId,
    );
    expect(toolPart).toBeDefined();
  });

  it("applyUIMessageChunksIncremental: text-delta accumulation across calls", async () => {
    const streamMessage = {
      streamId: "s-text",
      status: "streaming" as const,
      order: 0,
      stepOrder: 0,
      format: "UIMessageChunk" as const,
      agentName: "a",
    };
    let msg = blankUIMessage(streamMessage, "thread-text");
    let state = emptyIncrementalStreamState();
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t0" },
        { type: "text-delta", id: "t0", delta: "Hello " },
      ] as UIMessageChunk[],
      state,
    ));
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [{ type: "text-delta", id: "t0", delta: "world" }] as UIMessageChunk[],
      state,
    ));
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        { type: "text-delta", id: "t0", delta: "!" },
        { type: "text-end", id: "t0" },
      ] as UIMessageChunk[],
      state,
    ));

    const textPart = msg.parts.find((p) => p.type === "text") as
      | { text: string; state: string }
      | undefined;
    expect(textPart?.text).toBe("Hello world!");
    expect(textPart?.state).toBe("done");
    expect(msg.text).toBe("Hello world!");
  });

  it("applyUIMessageChunksIncremental: tool-output-available preserves input and sets fields", async () => {
    const streamMessage = {
      streamId: "s-tool-out",
      status: "streaming" as const,
      order: 0,
      stepOrder: 0,
      format: "UIMessageChunk" as const,
      agentName: "a",
    };
    let msg = blankUIMessage(streamMessage, "thread-tool-out");
    let state = emptyIncrementalStreamState();
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        { type: "start" },
        { type: "start-step" },
        { type: "tool-input-start", toolCallId: "c1", toolName: "myTool" },
        {
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "myTool",
          input: { q: "hi" },
        },
      ] as UIMessageChunk[],
      state,
    ));
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        {
          type: "tool-output-available",
          toolCallId: "c1",
          output: { result: "ok" },
          preliminary: true,
          providerExecuted: true,
        },
      ] as UIMessageChunk[],
      state,
    ));

    const toolPart = msg.parts.find(
      (p): p is ToolUIPart => "toolCallId" in p && p.toolCallId === "c1",
    );
    expect(toolPart?.state).toBe("output-available");
    expect(toolPart?.input).toEqual({ q: "hi" });
    expect((toolPart as { output?: unknown }).output).toEqual({ result: "ok" });
    expect((toolPart as { preliminary?: boolean }).preliminary).toBe(true);
    expect((toolPart as { providerExecuted?: boolean }).providerExecuted).toBe(true);
  });

  it("applyUIMessageChunksIncremental: tool-input-error sets rawInput and clears input for static tools", async () => {
    const streamMessage = {
      streamId: "s-tool-err",
      status: "streaming" as const,
      order: 0,
      stepOrder: 0,
      format: "UIMessageChunk" as const,
      agentName: "a",
    };
    let msg = blankUIMessage(streamMessage, "thread-tool-err");
    let state = emptyIncrementalStreamState();
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        { type: "start" },
        { type: "start-step" },
        { type: "tool-input-start", toolCallId: "c2", toolName: "myTool" },
      ] as UIMessageChunk[],
      state,
    ));
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        {
          type: "tool-input-error",
          toolCallId: "c2",
          toolName: "myTool",
          input: { bad: "args" },
          errorText: "validation failed",
        },
      ] as UIMessageChunk[],
      state,
    ));

    const toolPart = msg.parts.find(
      (p): p is ToolUIPart => "toolCallId" in p && p.toolCallId === "c2",
    );
    expect(toolPart?.state).toBe("output-error");
    expect((toolPart as { errorText?: string }).errorText).toBe(
      "validation failed",
    );
    expect(toolPart?.input).toBeUndefined();
    expect((toolPart as { rawInput?: unknown }).rawInput).toEqual({
      bad: "args",
    });
  });

  it("accumulates tool input across a batch boundary (parsePartialJson)", async () => {
    const streamMessage = {
      streamId: "s-tool-split",
      status: "streaming" as const,
      order: 0,
      stepOrder: 0,
      format: "UIMessageChunk" as const,
      agentName: "a",
    };
    let msg = blankUIMessage(streamMessage, "thread-tool-split");
    let state = emptyIncrementalStreamState();

    // Batch A: preamble + the first half of the JSON input.
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        { type: "start" },
        { type: "start-step" },
        { type: "tool-input-start", toolCallId: "c1", toolName: "myTool" },
        { type: "tool-input-delta", toolCallId: "c1", inputTextDelta: '{"a":1' },
      ] as UIMessageChunk[],
      state,
    ));
    const afterA = msg.parts.find(
      (p): p is ToolUIPart => "toolCallId" in p && p.toolCallId === "c1",
    );
    // Mid-stream input is a partial structured object, not a raw string.
    expect(afterA?.input).toEqual({ a: 1 });

    // Batch B: the remainder of the JSON input.
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        { type: "tool-input-delta", toolCallId: "c1", inputTextDelta: ',"b":2}' },
      ] as UIMessageChunk[],
      state,
    ));
    const afterB = msg.parts.find(
      (p): p is ToolUIPart => "toolCallId" in p && p.toolCallId === "c1",
    );
    // The batch-A accumulation is preserved, not dropped.
    expect(afterB?.input).toEqual({ a: 1, b: 2 });
    expect(state.toolInputText["c1"]).toBe('{"a":1,"b":2}');
  });

  it("pushes file parts and merges message metadata in later batches", async () => {
    const streamMessage = {
      streamId: "s-file-meta",
      status: "streaming" as const,
      order: 0,
      stepOrder: 0,
      format: "UIMessageChunk" as const,
      agentName: "a",
    };
    let msg = blankUIMessage(streamMessage, "thread-file-meta");
    let state = emptyIncrementalStreamState();
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        { type: "start" },
        { type: "start-step" },
      ] as UIMessageChunk[],
      state,
    ));
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        {
          type: "file",
          mediaType: "image/png",
          url: "https://example.com/a.png",
        },
        { type: "message-metadata", messageMetadata: { foo: "bar" } },
      ] as UIMessageChunk[],
      state,
    ));

    const filePart = msg.parts.find((p) => p.type === "file") as
      | { mediaType: string; url: string }
      | undefined;
    expect(filePart?.mediaType).toBe("image/png");
    expect(filePart?.url).toBe("https://example.com/a.png");
    expect(msg.metadata).toEqual({ foo: "bar" });
  });

  it("tracks concurrent text parts by id across batches", async () => {
    const streamMessage = {
      streamId: "s-multi-text",
      status: "streaming" as const,
      order: 0,
      stepOrder: 0,
      format: "UIMessageChunk" as const,
      agentName: "a",
    };
    let msg = blankUIMessage(streamMessage, "thread-multi-text");
    let state = emptyIncrementalStreamState();
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t0" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t0", delta: "A" },
      ] as UIMessageChunk[],
      state,
    ));
    // Deltas in a later batch must land on the part matching their id.
    ({ message: msg, streamState: state } = await applyUIMessageChunksIncremental(
      msg,
      [
        { type: "text-delta", id: "t1", delta: "B" },
        { type: "text-delta", id: "t0", delta: "C" },
      ] as UIMessageChunk[],
      state,
    ));

    const textParts = msg.parts.filter((p) => p.type === "text") as Array<{
      text: string;
    }>;
    expect(textParts.map((p) => p.text)).toEqual(["AC", "B"]);
  });

  it("incremental batches match the SDK processing the full stream", async () => {
    const streamMessage = {
      streamId: "s-equiv",
      status: "streaming" as const,
      order: 0,
      stepOrder: 0,
      format: "UIMessageChunk" as const,
      agentName: "a",
    };
    const batches: UIMessageChunk[][] = [
      [
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t0" },
        { type: "text-delta", id: "t0", delta: "Hello " },
      ] as UIMessageChunk[],
      [
        { type: "text-delta", id: "t0", delta: "world" },
        { type: "text-end", id: "t0" },
        { type: "tool-input-start", toolCallId: "c1", toolName: "myTool" },
        { type: "tool-input-delta", toolCallId: "c1", inputTextDelta: '{"q":' },
      ] as UIMessageChunk[],
      [
        { type: "tool-input-delta", toolCallId: "c1", inputTextDelta: '"hi"}' },
        {
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "myTool",
          input: { q: "hi" },
        },
        {
          type: "tool-output-available",
          toolCallId: "c1",
          output: { ok: true },
        },
        { type: "finish-step" },
        { type: "finish" },
      ] as UIMessageChunk[],
    ];

    // SDK: process the entire stream at once.
    const sdkMsg = await updateFromUIMessageChunks(
      blankUIMessage(streamMessage, "thread-equiv"),
      batches.flat(),
    );

    // Incremental: process batch by batch, threading state.
    let incMsg = blankUIMessage(streamMessage, "thread-equiv");
    let state = emptyIncrementalStreamState();
    for (const batch of batches) {
      ({ message: incMsg, streamState: state } =
        await applyUIMessageChunksIncremental(incMsg, batch, state));
    }

    expect(incMsg.parts).toEqual(sdkMsg.parts);
    expect(incMsg.text).toBe(sdkMsg.text);
  });

  it("handles streaming tool-approval-request and updates tool state", () => {
    const streamId = "s10";
    const deltas = [
      {
        streamId,
        start: 0,
        end: 1,
        parts: [
          {
            type: "tool-call",
            toolCallId: "call1",
            toolName: "dangerousTool",
            input: { action: "delete" },
          },
        ],
      } satisfies StreamDelta,
      {
        streamId,
        start: 1,
        end: 2,
        parts: [
          {
            type: "tool-approval-request",
            toolCallId: "call1",
            approvalId: "approval1",
          },
        ],
      } satisfies StreamDelta,
    ];
    const [[message], _, changed] = deriveUIMessagesFromTextStreamParts(
      "thread1",
      [{ streamId, order: 10, stepOrder: 0, status: "streaming" }],
      [],
      deltas,
    );
    expect(message).toBeDefined();
    expect(message.role).toBe("assistant");
    expect(changed).toBe(true);

    const toolPart = message.parts.find(
      (p) => p.type === "tool-dangerousTool",
    ) as any;
    expect(toolPart).toBeDefined();
    expect(toolPart.state).toBe("approval-requested");
    expect(toolPart.approval).toEqual({ id: "approval1" });
  });
});
