import { describe, expect, test } from "vitest";
import { z } from "zod";
import { stepCountIs } from "ai";
import { Agent, createTool, createThread } from "../index.js";
import {
  actionGeneric, anyApi, defineSchema,
  type ActionBuilder, type ApiFromModules, type DataModelFromSchemaDefinition,
} from "convex/server";
import { v } from "convex/values";
import { components, initConvexTest } from "./setup.test.js";
import { mockModel } from "./mockModel.js";

const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

const sleepTool = createTool({
  description: "sleep",
  inputSchema: z.object({ seconds: z.number() }),
  execute: async () => {
    await new Promise((r) => setTimeout(r, 200));
    return { slept: 3 };
  },
});

const agent = new Agent(components.agent, {
  name: "slow-tool",
  languageModel: mockModel({
    contentSteps: [
      [{ type: "tool-call", toolCallId: "t1", toolName: "sleepTool", input: JSON.stringify({ seconds: 3 }) }],
      [{ type: "text", text: "done" }],
    ],
  }),
  tools: { sleepTool },
});

export const run = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const r = await agent.streamText(
      ctx, { threadId }, { prompt: "go", stopWhen: stepCountIs(3) },
      { saveStreamDeltas: { chunking: "word", throttleMs: 50 } },
    );
    await r.consumeStream();
    return { ok: true };
  },
});

const testApi: ApiFromModules<{ fns: { run: typeof run } }>["fns"] =
  anyApi["deltaFlush.test"] as any;

describe("throttled deltas flush on time (issue #221)", () => {
  test("tool-input-available is flushed before the tool finishes", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "u" }),
    );
    await t.action(testApi.run, { threadId });
    await t.finishAllScheduledFunctions(() => {});
    const streams = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, { threadId, statuses: ["streaming","finished","aborted"] }),
    );
    const deltas = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.listDeltas, {
        threadId, cursors: streams.map((s: any) => ({ streamId: s.streamId, cursor: 0 })),
      }),
    );
    const withInput = deltas.findIndex((d: any) => d.parts.some((p: any) => p.type === "tool-input-available"));
    const withOutput = deltas.findIndex((d: any) => d.parts.some((p: any) => p.type === "tool-output-available"));
    expect(withInput).toBeGreaterThanOrEqual(0);
    expect(withOutput).toBeGreaterThan(withInput);
  });
});
