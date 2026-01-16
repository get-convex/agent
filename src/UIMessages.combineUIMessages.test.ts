import { describe, it, expect } from "vitest";
import { combineUIMessages, type UIMessage } from "./UIMessages.js";

describe("combineUIMessages", () => {
  it("should preserve all tool calls when combining messages", () => {
    const messages: UIMessage[] = [
      {
        id: "msg1",
        key: "thread-1-0",
        order: 1,
        stepOrder: 0,
        status: "streaming",
        role: "assistant",
        parts: [
          {
            type: "tool-toolA",
            toolCallId: "call_A",
            state: "input-available",
            input: {},
          },
        ],
        text: "",
        _creationTime: Date.now(),
      },
      {
        id: "msg1",
        key: "thread-1-0",
        order: 1,
        stepOrder: 0,
        status: "streaming",
        role: "assistant",
        parts: [
          {
            type: "tool-toolB",
            toolCallId: "call_B",
            state: "input-available",
            input: {},
          },
        ],
        text: "",
        _creationTime: Date.now(),
      },
    ];

    const result = combineUIMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].parts).toHaveLength(2);

    const toolCallIds = result[0].parts
      .filter((p) => p.type.startsWith("tool-"))
      .map((p: any) => p.toolCallId);

    expect(toolCallIds).toContain("call_A");
    expect(toolCallIds).toContain("call_B");
  });

  it("should accumulate tool calls progressively (issue #182)", () => {
    // Simulating: A(started) → B → C → A(result)
    const messages: UIMessage[] = [
      {
        id: "msg1",
        key: "thread-1-0",
        order: 1,
        stepOrder: 0,
        status: "streaming",
        role: "assistant",
        parts: [
          {
            type: "tool-toolA",
            toolCallId: "call_A",
            state: "input-available",
            input: {},
          },
        ],
        text: "",
        _creationTime: Date.now(),
      },
      {
        id: "msg1",
        key: "thread-1-0",
        order: 1,
        stepOrder: 0,
        status: "streaming",
        role: "assistant",
        parts: [
          {
            type: "tool-toolA",
            toolCallId: "call_A",
            state: "input-available",
            input: {},
          },
          {
            type: "tool-toolB",
            toolCallId: "call_B",
            state: "input-available",
            input: {},
          },
        ],
        text: "",
        _creationTime: Date.now(),
      },
      {
        id: "msg1",
        key: "thread-1-0",
        order: 1,
        stepOrder: 0,
        status: "streaming",
        role: "assistant",
        parts: [
          {
            type: "tool-toolA",
            toolCallId: "call_A",
            state: "input-available",
            input: {},
          },
          {
            type: "tool-toolB",
            toolCallId: "call_B",
            state: "input-available",
            input: {},
          },
          {
            type: "tool-toolC",
            toolCallId: "call_C",
            state: "input-available",
            input: {},
          },
        ],
        text: "",
        _creationTime: Date.now(),
      },
      {
        id: "msg1",
        key: "thread-1-0",
        order: 1,
        stepOrder: 0,
        status: "success",
        role: "assistant",
        parts: [
          {
            type: "tool-toolA",
            toolCallId: "call_A",
            state: "output-available",
            input: {},
            output: "success",
          },
          {
            type: "tool-toolB",
            toolCallId: "call_B",
            state: "input-available",
            input: {},
          },
          {
            type: "tool-toolC",
            toolCallId: "call_C",
            state: "input-available",
            input: {},
          },
        ],
        text: "",
        _creationTime: Date.now(),
      },
    ];

    const result = combineUIMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].parts).toHaveLength(3);

    const toolCallIds = result[0].parts
      .filter((p) => p.type.startsWith("tool-"))
      .map((p: any) => p.toolCallId);

    // All tool calls should be present
    expect(toolCallIds).toContain("call_A");
    expect(toolCallIds).toContain("call_B");
    expect(toolCallIds).toContain("call_C");

    // Tool A should have the final state (output-available)
    const toolA = result[0].parts.find(
      (p: any) => p.type === "tool-toolA" && p.toolCallId === "call_A",
    ) as any;
    expect(toolA.state).toBe("output-available");
    expect(toolA.output).toBe("success");
  });

  it("should merge tool calls with same toolCallId", () => {
    const messages: UIMessage[] = [
      {
        id: "msg1",
        key: "thread-1-0",
        order: 1,
        stepOrder: 0,
        status: "streaming",
        role: "assistant",
        parts: [
          {
            type: "tool-toolA",
            toolCallId: "call_A",
            state: "input-available",
            input: { test: "input" },
          },
        ],
        text: "",
        _creationTime: Date.now(),
      },
      {
        id: "msg1",
        key: "thread-1-0",
        order: 1,
        stepOrder: 0,
        status: "success",
        role: "assistant",
        parts: [
          {
            type: "tool-toolA",
            toolCallId: "call_A",
            state: "output-available",
            input: { test: "input" },
            output: "completed",
          },
        ],
        text: "",
        _creationTime: Date.now(),
      },
    ];

    const result = combineUIMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].parts).toHaveLength(1);

    const toolCall = result[0].parts[0] as any;
    expect(toolCall.toolCallId).toBe("call_A");
    expect(toolCall.state).toBe("output-available");
    expect(toolCall.output).toBe("completed");
  });
});
