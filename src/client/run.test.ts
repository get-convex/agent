import { describe, expect, test, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { runMutation, runQuery } from "./run.js";
import type { MutationCtx } from "./types.js";

const mutation = {} as FunctionReference<"mutation">;
const query = {} as FunctionReference<"query">;

describe("run", () => {
  test("workflow steps run inline", async () => {
    const ctx = {
      workflowId: "workflow",
      runMutation: vi.fn(async () => "m"),
      runQuery: vi.fn(async () => "q"),
    };
    await expect(runMutation(ctx as never, mutation, {})).resolves.toBe("m");
    await expect(runQuery(ctx as never, query, {})).resolves.toBe("q");
    expect(ctx.runMutation.mock.calls).toEqual([
      [mutation, {}, { inline: true }],
    ]);
    expect(ctx.runQuery.mock.calls).toEqual([[query, {}, { inline: true }]]);
  });

  test("a workflow step ctx type-checks without a cast", () => {
    const accept = (step: WorkflowCtx): MutationCtx => {
      void runMutation(step, mutation, {});
      void runQuery(step, query, {});
      return step;
    };
    expect(accept).toBeTypeOf("function");
  });

  test("other contexts get no run options", async () => {
    const ctx = {
      runMutation: vi.fn(async () => "m"),
      runQuery: vi.fn(async () => "q"),
    };
    await runMutation(ctx as never, mutation, {});
    await runQuery(ctx as never, query, {});
    expect(ctx.runMutation.mock.calls).toEqual([[mutation, {}]]);
    expect(ctx.runQuery.mock.calls).toEqual([[query, {}]]);
  });
});
