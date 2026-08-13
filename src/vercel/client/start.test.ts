import { describe, expect, it } from "vitest";
import { resolveUsageModel } from "./start.js";

describe("resolveUsageModel", () => {
  it("prefers a step model while object results retain the active model", () => {
    const activeModel = { provider: "fallback", model: "fallback-model" };
    const stepModel = { provider: "router", model: "routed-model" };

    expect(resolveUsageModel({ step: { model: stepModel } }, activeModel)).toBe(
      stepModel,
    );
    expect(resolveUsageModel({ object: {} }, activeModel)).toBe(activeModel);
  });
});
