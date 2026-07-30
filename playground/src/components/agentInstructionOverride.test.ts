import { describe, expect, test } from "vitest";
import {
  instructionOverrideForAgent,
  updateInstructionOverride,
} from "./agentInstructionOverride.js";

describe("agent instruction overrides", () => {
  test("never exposes one agent's dirty override to another agent", () => {
    const override = updateInstructionOverride(
      "agent-a",
      "Agent A instructions",
      "Agent A override",
    );

    expect(instructionOverrideForAgent(override, "agent-a")).toBe(
      "Agent A override",
    );
    expect(instructionOverrideForAgent(override, "agent-b")).toBeUndefined();
  });

  test("clears the override when the editable projection is restored", () => {
    expect(
      updateInstructionOverride(
        "agent-a",
        "Agent A instructions",
        "Agent A instructions",
      ),
    ).toBeUndefined();
  });

  test("keeps an explicit empty override distinct from no override", () => {
    expect(updateInstructionOverride("agent-a", "Default", "")).toEqual({
      agentName: "agent-a",
      value: "",
    });
  });
});
