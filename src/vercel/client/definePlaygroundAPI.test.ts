import { describe, expect, test } from "vitest";
import {
  instructionsToEditableText,
  resolvePlaygroundInstructions,
} from "./definePlaygroundAPI.js";

describe("instructionsToEditableText", () => {
  test("preserves plain string instructions", () => {
    expect(instructionsToEditableText("Be concise.")).toBe("Be concise.");
  });

  test("projects one structured system message to editable text", () => {
    expect(
      instructionsToEditableText({
        role: "system",
        content: "Be precise.",
        providerOptions: { openai: { reasoningEffort: "high" } },
      }),
    ).toBe("Be precise.");
  });

  test("projects structured system messages in order", () => {
    expect(
      instructionsToEditableText([
        { role: "system", content: "Be precise." },
        { role: "system", content: "Cite sources." },
      ]),
    ).toBe("Be precise.\n\nCite sources.");
  });

  test("preserves the absence of instructions", () => {
    expect(instructionsToEditableText(undefined)).toBeUndefined();
  });
});

describe("resolvePlaygroundInstructions", () => {
  test("passes a structured system message through without flattening it", () => {
    const instructions = {
      role: "system" as const,
      content: "Be precise.",
      providerOptions: { openai: { reasoningEffort: "high" } },
    };
    expect(resolvePlaygroundInstructions(instructions, undefined)).toBe(
      instructions,
    );
  });

  test("passes structured system-message arrays through in order", () => {
    const instructions = [
      { role: "system" as const, content: "Be precise." },
      { role: "system" as const, content: "Cite sources." },
    ];
    expect(resolvePlaygroundInstructions(instructions, undefined)).toBe(
      instructions,
    );
  });

  test("prefers canonical instructions and retains the legacy system fallback", () => {
    expect(resolvePlaygroundInstructions("canonical", "legacy")).toBe(
      "canonical",
    );
    expect(resolvePlaygroundInstructions(undefined, "legacy")).toBe("legacy");
  });
});
