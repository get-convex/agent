import { describe, expect, test } from "vitest";
import { withCompaction } from "./start.js";
import { DEFAULT_COMPACTION_TRIGGER_TOKENS } from "../shared.js";

describe("withCompaction", () => {
  test("adds a compact edit with the default trigger when none exist", () => {
    const result = withCompaction(undefined, {});
    expect(result.anthropic?.contextManagement).toEqual({
      edits: [
        {
          type: "compact_20260112",
          trigger: {
            type: "input_tokens",
            value: DEFAULT_COMPACTION_TRIGGER_TOKENS,
          },
        },
      ],
    });
  });

  test("honors a custom trigger and instructions", () => {
    const result = withCompaction(undefined, {
      triggerTokens: 80_000,
      instructions: "Keep the decisions.",
    });
    expect(result.anthropic?.contextManagement).toEqual({
      edits: [
        {
          type: "compact_20260112",
          trigger: { type: "input_tokens", value: 80_000 },
          instructions: "Keep the decisions.",
        },
      ],
    });
  });

  test("preserves other providers and other anthropic keys", () => {
    const result = withCompaction(
      { openai: { foo: "bar" }, anthropic: { thinking: { type: "enabled" } } },
      {},
    );
    expect(result.openai).toEqual({ foo: "bar" });
    expect(result.anthropic?.thinking).toEqual({ type: "enabled" });
    expect(
      (result.anthropic?.contextManagement as { edits: unknown[] }).edits,
    ).toHaveLength(1);
  });

  test("does not double-add when a compact edit is already present", () => {
    const existing = {
      anthropic: {
        contextManagement: {
          edits: [{ type: "compact_20260112", trigger: { type: "input_tokens", value: 10 } }],
        },
      },
    };
    const result = withCompaction(existing, { triggerTokens: 99_999 });
    const edits = (result.anthropic?.contextManagement as { edits: unknown[] })
      .edits;
    expect(edits).toHaveLength(1);
    // keeps the existing edit untouched (does not overwrite with 99_999)
    expect(edits[0]).toEqual({
      type: "compact_20260112",
      trigger: { type: "input_tokens", value: 10 },
    });
  });

  test("rejects a triggerTokens below the 50k minimum", () => {
    expect(() => withCompaction(undefined, { triggerTokens: 1000 })).toThrow(
      /at least|>= 50000|integer/i,
    );
  });

  test("rejects a non-integer triggerTokens", () => {
    expect(() => withCompaction(undefined, { triggerTokens: 50_000.5 })).toThrow(
      /integer/i,
    );
  });

  test("appends alongside a different existing edit (e.g. clear_tool_uses)", () => {
    const existing = {
      anthropic: {
        contextManagement: {
          edits: [{ type: "clear_tool_uses_20250919" }],
        },
      },
    };
    const result = withCompaction(existing, {});
    const edits = (result.anthropic?.contextManagement as { edits: unknown[] })
      .edits;
    expect(edits).toHaveLength(2);
    expect((edits[1] as { type: string }).type).toBe("compact_20260112");
  });
});
