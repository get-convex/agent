/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { api } from "../_generated/api.js";
import { initConvexTest } from "../setup.test.js";

test("orchestration preserves the planned agent handoff", async () => {
  const result = await initConvexTest().action(
    api.workflows.coordination.orchestrate,
    { prompt: "Plan a small release" },
  );

  expect(result.steps.map(({ agent }) => agent)).toEqual([
    "coordinator",
    "analyst",
    "critic",
    "coordinator",
  ]);
});
