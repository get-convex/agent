import { describe, expect, test } from "vitest";
import { Agent, createTool } from "./index.js";
import type {
  DataModelFromSchemaDefinition,
  ApiFromModules,
  ActionBuilder,
  MutationBuilder,
} from "convex/server";
import { anyApi, actionGeneric, mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { defineSchema } from "convex/server";
import { stepCountIs } from "ai";
import { components, initConvexTest } from "./setup.test.js";
import { z } from "zod/v4";
import { mockModel } from "./mockModel.js";

const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const action = actionGeneric as ActionBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;

// A trivial mutation the tool will invoke via ctx.runMutation.
export const noop = mutation({
  args: {},
  returns: v.string(),
  handler: async () => "ok",
});

// Tool whose execute actually calls ctx.runMutation, like a real app.
const bumpTool = createTool({
  description: "Bump a counter",
  inputSchema: z.object({ key: z.string() }),
  execute: async (ctx, input) => {
    // The first call ("a") deliberately yields the event loop so a parallel
    // repeat ("b") interleaves before this one resolves — surfacing any
    // shared-mutable-ctx clobbering between concurrent same-tool executions.
    if (input.key === "a") {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const hasRunMutation = typeof ctx.runMutation === "function";
    if (!hasRunMutation) {
      return `NO_RUN_MUTATION for ${input.key}`;
    }
    const r = await ctx.runMutation(anyApi["issue283.test"].noop, {});
    return `bumped ${input.key}: ${r}`;
  },
});

// Model that emits the SAME tool twice in a single step, then text.
const agent = new Agent(components.agent, {
  name: "issue283",
  instructions: "test",
  tools: { bump: bumpTool },
  languageModel: mockModel({
    contentSteps: [
      [
        {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "bump",
          input: JSON.stringify({ key: "a" }),
        },
        {
          type: "tool-call",
          toolCallId: "tc-2",
          toolName: "bump",
          input: JSON.stringify({ key: "b" }),
        },
      ],
      [{ type: "text", text: "done" }],
    ],
  }),
  stopWhen: stepCountIs(5),
});

export const runGenerate = action({
  args: {},
  handler: async (ctx) => {
    const { thread } = await agent.createThread(ctx, { userId: "u1" });
    const result = await thread.generateText({ prompt: "bump a and b" });
    const toolResults = result.steps.flatMap((s) =>
      s.content
        .filter((c) => c.type === "tool-result")
        .map((c) => (c as { output: unknown }).output),
    );
    return { toolResults };
  },
});

export const runStream = action({
  args: {},
  handler: async (ctx) => {
    const { thread } = await agent.createThread(ctx, { userId: "u2" });
    const result = await thread.streamText(
      { prompt: "bump a and b" },
      { saveStreamDeltas: false },
    );
    // Consume the stream fully so tool calls execute.
    await result.consumeStream();
    const steps = await result.steps;
    const toolResults = steps.flatMap((s) =>
      s.content
        .filter((c) => c.type === "tool-result")
        .map((c) => (c as { output: unknown }).output),
    );
    return { toolResults };
  },
});

const testApi: ApiFromModules<{
  fns: {
    runGenerate: typeof runGenerate;
    runStream: typeof runStream;
    noop: typeof noop;
  };
}>["fns"] = anyApi["issue283.test"] as any;

describe("issue #283: ctx.runMutation on repeated same-tool calls", () => {
  test("generateText: both same-tool calls keep ctx.runMutation", async () => {
    const t = initConvexTest(schema);
    const { toolResults } = await t.action(testApi.runGenerate, {});
    expect([...toolResults].sort()).toEqual(["bumped a: ok", "bumped b: ok"]);
  });

  test("streamText: both same-tool calls keep ctx.runMutation", async () => {
    const t = initConvexTest(schema);
    const { toolResults } = await t.action(testApi.runStream, {});
    expect([...toolResults].sort()).toEqual(["bumped a: ok", "bumped b: ok"]);
  });
});
