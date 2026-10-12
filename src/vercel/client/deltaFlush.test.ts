import { describe, expect, test } from "vitest";
import { z } from "zod";
import { stepCountIs } from "ai";
import { Agent, createTool, createThread } from "../index.js";
import { v } from "convex/values";
import { app, components } from "./setup.test.js";
import { mockModel } from "./mockModel.js";

// The AI SDK emits tool-input-available before the tool runs. The whole point
// of issue #221 is that a client can see it while the tool is still working,
// so the tool itself is where the delta log has to be read.
const partsSeenDuringTool: string[] = [];

const sleepTool = createTool({
  description: "sleep",
  inputSchema: z.object({ seconds: z.number() }),
  execute: async (ctx) => {
    const readTypes = async () => {
      const streams = await ctx.runQuery(components.agent.streams.list, {
        threadId: ctx.threadId!,
        statuses: ["streaming"],
      });
      const deltas = await ctx.runQuery(components.agent.streams.listDeltas, {
        threadId: ctx.threadId!,
        cursors: streams.map((s) => ({ streamId: s.streamId, cursor: 0 })),
      });
      return deltas.flatMap((d) => d.parts.map((p) => p.type));
    };
    // Wait on the condition rather than on a fixed sleep chosen to outrun the
    // throttle: there is no margin to tune, so machine load cannot decide the
    // outcome. Without a scheduled flush this simply never arrives.
    const deadline = Date.now() + 2_000;
    let types = await readTypes();
    while (!types.includes("tool-input-available") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      types = await readTypes();
    }
    partsSeenDuringTool.push(...types);
    return { slept: 3 };
  },
});

const agent = new Agent(components.agent, {
  name: "slow-tool",
  languageModel: mockModel({
    contentSteps: [
      [
        {
          type: "tool-call",
          toolCallId: "t1",
          toolName: "sleepTool",
          input: JSON.stringify({ seconds: 3 }),
        },
      ],
      [{ type: "text", text: "done" }],
    ],
  }),
  tools: { sleepTool },
});

const run = app.action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const r = await agent.streamText(
      ctx,
      { threadId },
      { prompt: "go", stopWhen: stepCountIs(3) },
      { saveStreamDeltas: { chunking: "word", throttleMs: 50 } },
    );
    await r.consumeStream();
    return { ok: true };
  },
});

const { api, createTest } = app.defineModules({
  deltaFlush: { run },
});

describe("throttled deltas flush on time (issue #221)", () => {
  test("the tool call is queryable while the tool is still running", async () => {
    partsSeenDuringTool.length = 0;
    const t = createTest();
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "u" }),
    );

    await t.action(api.deltaFlush.run, { threadId });
    await t.finishAllScheduledFunctions(() => {});

    expect(partsSeenDuringTool).toContain("tool-input-available");
    expect(partsSeenDuringTool).not.toContain("tool-output-available");
  });
});
