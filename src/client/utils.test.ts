import { describe, it, expect } from "vitest";
import { willContinue } from "./utils.js";
import type { StepResult } from "ai";

describe("willContinue", () => {
  it("should return false when finishReason is not tool-calls", async () => {
    const steps = [
      {
        finishReason: "stop",
        toolCalls: [],
        toolResults: [],
      },
    ] as unknown as StepResult<any>[];

    const result = await willContinue(steps, undefined);
    expect(result).toBe(false);
  });

  it("should return false when waiting for tool results", async () => {
    const steps = [
      {
        finishReason: "tool-calls",
        toolCalls: [{ toolCallId: "1", toolName: "test", args: {} }],
        toolResults: [],
      },
    ] as unknown as StepResult<any>[];

    const result = await willContinue(steps, undefined);
    expect(result).toBe(false);
  });

  it("should evaluate stopWhen when tool results are present", async () => {
    const steps = [
      {
        finishReason: "tool-calls",
        toolCalls: [{ toolCallId: "1", toolName: "test", args: {} }],
        toolResults: [
          { toolCallId: "1", toolName: "test", result: "success" },
        ],
      },
    ] as unknown as StepResult<any>[];

    const stopWhen = () => true; // Should stop
    const result = await willContinue(steps, stopWhen);
    expect(result).toBe(false); // willContinue returns false when stop is true
  });

  it("should continue when stopWhen returns false", async () => {
    const steps = [
      {
        finishReason: "tool-calls",
        toolCalls: [{ toolCallId: "1", toolName: "test", args: {} }],
        toolResults: [
          { toolCallId: "1", toolName: "test", result: "success" },
        ],
      },
    ] as unknown as StepResult<any>[];

    const stopWhen = () => false; // Should not stop
    const result = await willContinue(steps, stopWhen);
    expect(result).toBe(true); // willContinue returns true when stop is false
  });

  it("should continue (not stop) when tool result has an error (issue #172)", async () => {
    // When a tool call fails Zod validation, the result contains an error message
    const steps = [
      {
        finishReason: "tool-calls",
        toolCalls: [
          { toolCallId: "1", toolName: "generateImage", args: { id: "invalid" } },
        ],
        toolResults: [
          {
            toolCallId: "1",
            toolName: "generateImage",
            result:
              'ArgumentValidationError: Value does not match validator.\nPath: .id\nValue: "invalid"\nValidator: v.id("images")',
            isError: true,
          },
        ],
      },
    ] as unknown as StepResult<any>[];

    // hasToolCall("generateImage") would return true, causing stopWhen to stop
    const stopWhen = ({ steps }: { steps: StepResult<any>[] }) => {
      const lastStep = steps.at(-1);
      return (
        lastStep?.toolCalls.some((tc) => tc.toolName === "generateImage") ??
        false
      );
    };

    const result = await willContinue(steps, stopWhen);
    // Should return true (continue) because the tool errored, even though
    // stopWhen would normally trigger a stop for this tool
    expect(result).toBe(true);
  });

  it("should stop when tool succeeds and stopWhen matches", async () => {
    const steps = [
      {
        finishReason: "tool-calls",
        toolCalls: [
          { toolCallId: "1", toolName: "generateImage", args: { id: "valid" } },
        ],
        toolResults: [
          {
            toolCallId: "1",
            toolName: "generateImage",
            result: { success: true, imageUrl: "https://example.com/image.png" },
            isError: false,
          },
        ],
      },
    ] as unknown as StepResult<any>[];

    const stopWhen = ({ steps }: { steps: StepResult<any>[] }) => {
      const lastStep = steps.at(-1);
      return (
        lastStep?.toolCalls.some((tc) => tc.toolName === "generateImage") ??
        false
      );
    };

    const result = await willContinue(steps, stopWhen);
    // Should return false (stop) because the tool succeeded
    expect(result).toBe(false);
  });

  it("should handle array of stopWhen conditions", async () => {
    const steps = [
      {
        finishReason: "tool-calls",
        toolCalls: [{ toolCallId: "1", toolName: "test", args: {} }],
        toolResults: [
          { toolCallId: "1", toolName: "test", result: "success" },
        ],
      },
    ] as unknown as StepResult<any>[];

    const stopWhen = [() => false, () => false];
    const result = await willContinue(steps, stopWhen);
    expect(result).toBe(true);
  });

  it("should stop when any stopWhen condition returns true", async () => {
    const steps = [
      {
        finishReason: "tool-calls",
        toolCalls: [{ toolCallId: "1", toolName: "test", args: {} }],
        toolResults: [
          { toolCallId: "1", toolName: "test", result: "success" },
        ],
      },
    ] as unknown as StepResult<any>[];

    const stopWhen = [() => false, () => true];
    const result = await willContinue(steps, stopWhen);
    expect(result).toBe(false);
  });
});
