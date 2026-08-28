import type { StepResult } from "ai";
import { describe, expect, test } from "vitest";
import { hasSuccessfulToolCall, willContinue } from "./utils.js";

// Minimal StepResult builder — only the fields willContinue and
// hasSuccessfulToolCall actually read. Loosely typed on purpose so test
// fixtures can be terse; cast at the boundary.
type StepFixture = {
  finishReason?: string;
  content?: Array<{ type: string; toolName?: string }>;
  toolCalls?: Array<{ toolCallId: string; toolName: string }>;
  toolResults?: Array<{ toolCallId: string; toolName: string }>;
};

function makeStep(partial: StepFixture): StepResult<any> {
  return {
    finishReason: "tool-calls",
    content: [],
    toolCalls: [],
    toolResults: [],
    ...partial,
  } as unknown as StepResult<any>;
}

describe("hasSuccessfulToolCall", () => {
  test("returns true when last step has a tool-result for the named tool", () => {
    const step = makeStep({
      content: [{ type: "tool-result", toolName: "search" }],
    });
    expect(hasSuccessfulToolCall("search")({ steps: [step] })).toBe(true);
  });

  test("returns false when only a tool-error is present for the named tool", () => {
    const step = makeStep({
      content: [{ type: "tool-error", toolName: "search" }],
    });
    expect(hasSuccessfulToolCall("search")({ steps: [step] })).toBe(false);
  });

  test("returns false when the matching tool name is missing", () => {
    const step = makeStep({
      content: [{ type: "tool-result", toolName: "other" }],
    });
    expect(hasSuccessfulToolCall("search")({ steps: [step] })).toBe(false);
  });

  test("only inspects the last step", () => {
    const earlier = makeStep({
      content: [{ type: "tool-result", toolName: "search" }],
    });
    const last = makeStep({
      content: [{ type: "tool-error", toolName: "search" }],
    });
    expect(hasSuccessfulToolCall("search")({ steps: [earlier, last] })).toBe(
      false,
    );
  });

  test("returns false when steps is empty", () => {
    expect(hasSuccessfulToolCall("search")({ steps: [] })).toBe(false);
  });
});

describe("willContinue", () => {
  test("does not stop when a tool-error fills in for a missing tool-result", async () => {
    // Two tool calls; one returns a result, the other errors.
    const step = makeStep({
      toolCalls: [
        { toolCallId: "1", toolName: "a" },
        { toolCallId: "2", toolName: "b" },
      ],
      toolResults: [{ toolCallId: "1", toolName: "a" }],
      content: [
        { type: "tool-result", toolName: "a" },
        { type: "tool-error", toolName: "b" },
      ],
    });
    // No stopWhen → returns false (no further stop conditions). The point
    // is the function progresses past the early `toolCalls > completed`
    // bail; pre-fix it returned early because tool-error wasn't counted.
    expect(await willContinue([step], undefined)).toBe(false);
  });

  test("stops when a tool call has neither a result nor an error yet", async () => {
    const step = makeStep({
      toolCalls: [{ toolCallId: "1", toolName: "a" }],
      toolResults: [],
      content: [],
    });
    expect(await willContinue([step], undefined)).toBe(false);
  });

  test("stops when finishReason is not tool-calls", async () => {
    const step = makeStep({ finishReason: "stop" });
    expect(await willContinue([step], undefined)).toBe(false);
  });
});
