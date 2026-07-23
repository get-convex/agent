import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { mockModel, type MockModelArgs } from "./mockModel.js";

const callOptions = {} as Parameters<LanguageModelV3["doGenerate"]>[0];

async function streamParts(
  model: LanguageModelV3,
): Promise<LanguageModelV3StreamPart[]> {
  const { stream } = await model.doStream(callOptions);
  const reader = stream.getReader();
  const parts: LanguageModelV3StreamPart[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) return parts;
    parts.push(result.value);
  }
}

async function expectModelFailure(fail: MockModelArgs["fail"]) {
  const model = mockModel({ fail });

  await expect(model.doGenerate(callOptions)).rejects.toThrow(
    "Mock error message",
  );
  const parts = await streamParts(model);
  expect(parts).toContainEqual({ type: "error", error: "Mock error message" });
  expect(parts).toContainEqual(
    expect.objectContaining({ type: "finish", finishReason: "error" }),
  );
}

async function expectModelSuccess(fail: MockModelArgs["fail"]) {
  const model = mockModel({ fail });

  await expect(model.doGenerate(callOptions)).resolves.toMatchObject({
    finishReason: "stop",
  });
  const parts = await streamParts(model);
  expect(parts.some((part) => part.type === "error")).toBe(false);
  expect(parts).toContainEqual(
    expect.objectContaining({ type: "finish", finishReason: "stop" }),
  );
}

describe("mockModel failure probability", () => {
  it.each([
    ["true", true],
    ["an object without probability", {}],
    ["probability 1", { probability: 1 }],
  ] as const)(
    "always fails generate and stream for %s",
    async (_name, fail) => {
      await expectModelFailure(fail);
    },
  );

  it("never fails generate or stream for probability 0", async () => {
    await expectModelSuccess({ probability: 0 });
  });

  it("uses Math.random for intermediate probabilities", async () => {
    const random = vi.spyOn(Math, "random");
    try {
      random.mockReturnValueOnce(0.24);
      await expectModelFailure({ probability: 0.25 });

      random.mockReturnValueOnce(0.25);
      await expectModelSuccess({ probability: 0.25 });
    } finally {
      random.mockRestore();
    }
  });
});
