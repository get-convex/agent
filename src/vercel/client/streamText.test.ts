import { describe, expect, test } from "vitest";
import { Agent, createThread } from "../index.js";
import {
  defineSchema,
  type DataModelFromSchemaDefinition,
  type ApiFromModules,
  type ActionBuilder,
  actionGeneric,
  anyApi,
} from "convex/server";
import { v } from "convex/values";
import { components, initConvexTest } from "./setup.test.js";
import { mockModel } from "./mockModel.js";
import { runAbortCleanup } from "./streamText.js";

const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

const FINAL_TEXT = "Hello from the model";

const agent = new Agent(components.agent, {
  name: "stream-test",
  languageModel: mockModel({
    content: [{ type: "text", text: FINAL_TEXT }],
  }),
});

const emptyAgent = new Agent(components.agent, {
  name: "empty-stream-test",
  languageModel: mockModel({
    content: [],
    providerMetadata: { mock: { emptyResponse: true } },
  }),
});

// Action that exercises streamText with saveStreamDeltas.returnImmediately=true.
// It consumes the stream after streamText returns, simulating the HTTP response
// path described in issue #265.
export const streamTextReturnImmediately = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const result = await agent.streamText(
      ctx,
      { threadId },
      { prompt: "Test" },
      {
        saveStreamDeltas: {
          returnImmediately: true,
          chunking: "word",
          throttleMs: 0,
        },
      },
    );
    // Drain the stream the way an HTTP response would. This triggers
    // onStepFinish for every step, including the final one.
    await result.consumeStream();
    return { ok: true };
  },
});

export const streamTextEmptyAwaited = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await emptyAgent.streamText(
      ctx,
      { threadId },
      { prompt: "Test" },
      { saveStreamDeltas: true },
    );
    return { ok: true };
  },
});

export const streamTextEmptyReturnImmediately = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const result = await emptyAgent.streamText(
      ctx,
      { threadId },
      { prompt: "Test" },
      {
        saveStreamDeltas: {
          returnImmediately: true,
          throttleMs: 0,
        },
      },
    );
    await result.consumeStream();
    return { ok: true };
  },
});

export const streamTextThrottled = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const result = await agent.streamText(
      ctx,
      { threadId },
      { prompt: "Test" },
      {
        saveStreamDeltas: {
          returnImmediately: true,
          chunking: "word",
          throttleMs: 60_000,
        },
      },
    );
    await result.consumeStream();
    return { ok: true };
  },
});

// Same as streamTextThrottled, but awaited: streamText consumes the stream
// itself, so the terminal transition happens at end-of-stream.
export const streamTextThrottledAwaited = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await agent.streamText(
      ctx,
      { threadId },
      { prompt: "Test" },
      {
        saveStreamDeltas: {
          chunking: "word",
          throttleMs: 60_000,
        },
      },
    );
    return { ok: true };
  },
});

export const streamTextNoStorage = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await agent.streamText(
      ctx,
      { threadId },
      { prompt: "Test" },
      {
        saveStreamDeltas: { chunking: "word", throttleMs: 0 },
        storageOptions: { saveMessages: "none" },
      },
    );
    return { ok: true };
  },
});

export const streamTextNoStorageImmediate = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const r = await agent.streamText(
      ctx,
      { threadId },
      { prompt: "Test" },
      {
        saveStreamDeltas: {
          returnImmediately: true,
          chunking: "word",
          throttleMs: 0,
        },
        storageOptions: { saveMessages: "none" },
      },
    );
    await r.consumeStream();
    return { ok: true };
  },
});

const testApi: ApiFromModules<{
  fns: {
    streamTextReturnImmediately: typeof streamTextReturnImmediately;
    streamTextThrottled: typeof streamTextThrottled;
    streamTextThrottledAwaited: typeof streamTextThrottledAwaited;
    streamTextNoStorage: typeof streamTextNoStorage;
    streamTextNoStorageImmediate: typeof streamTextNoStorageImmediate;
    streamTextEmptyAwaited: typeof streamTextEmptyAwaited;
    streamTextEmptyReturnImmediately: typeof streamTextEmptyReturnImmediately;
  };
}>["fns"] = anyApi["streamText.test"] as any;

describe("streamText with saveStreamDeltas.returnImmediately (issue #265)", () => {
  test("persists the final assistant text to the messages table", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "u1" }),
    );

    await t.action(testApi.streamTextReturnImmediately, { threadId });

    // Allow any background work scheduled by consumeStream to settle.
    await t.finishAllScheduledFunctions(() => {});

    const messages = await t.run(async (ctx) =>
      agent.listMessages(ctx, {
        threadId,
        paginationOpts: { cursor: null, numItems: 50 },
      }),
    );

    const assistantTextMessages = messages.page.filter(
      (m) =>
        m.message?.role === "assistant" &&
        typeof m.text === "string" &&
        m.text.length > 0,
    );
    expect(
      assistantTextMessages.length,
      "expected at least one persisted assistant message with text",
    ).toBeGreaterThan(0);

    const combined = assistantTextMessages.map((m) => m.text).join("");
    expect(combined).toContain(FINAL_TEXT);

    // The stream should be marked finished, not stuck in "streaming".
    const stillStreaming = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId,
        statuses: ["streaming"],
      }),
    );
    expect(
      stillStreaming,
      "stream should not be stuck in 'streaming' status",
    ).toHaveLength(0);
  });
});

describe("streamText abort cleanup", () => {
  test("attempts every cleanup and rethrows the first internal failure", async () => {
    const calls: string[] = [];
    const firstFailure = new Error("failed pending message cleanup");

    await expect(
      runAbortCleanup({
        failCall: async () => {
          calls.push("call.fail");
          throw firstFailure;
        },
        failStreamer: async () => {
          calls.push("streamer.fail");
          throw new Error("failed stream cleanup");
        },
        onAbort: () => {
          calls.push("user.onAbort");
        },
      }),
    ).rejects.toBe(firstFailure);

    expect(calls).toEqual(["call.fail", "streamer.fail", "user.onAbort"]);
  });
});

describe("streamText with an empty final step (issue #274)", () => {
  test.each([
    ["awaited", testApi.streamTextEmptyAwaited],
    ["returnImmediately", testApi.streamTextEmptyReturnImmediately],
  ])(
    "finalizes the pending assistant message in the %s path",
    async (_, fn) => {
      const t = initConvexTest(schema);
      const threadId = await t.run(async (ctx) =>
        createThread(ctx, components.agent, { userId: "u1" }),
      );

      await t.action(fn, { threadId });
      await t.finishAllScheduledFunctions(() => {});

      const messages = await t.run(async (ctx) =>
        emptyAgent.listMessages(ctx, {
          threadId,
          paginationOpts: { cursor: null, numItems: 50 },
        }),
      );

      expect(
        messages.page.filter((message) => message.status === "pending"),
      ).toHaveLength(0);
      expect(messages.page).toContainEqual(
        expect.objectContaining({
          status: "success",
          message: { role: "assistant", content: [] },
          model: "mock-model-id",
          provider: "mock-provider",
          providerMetadata: { mock: { emptyResponse: true } },
          usage: expect.objectContaining({
            promptTokens: 3,
            completionTokens: 10,
            totalTokens: 13,
          }),
        }),
      );

      const stillStreaming = await t.run(async (ctx) =>
        ctx.runQuery(components.agent.streams.list, {
          threadId,
          statuses: ["streaming"],
        }),
      );
      expect(stillStreaming).toHaveLength(0);
    },
  );
});

describe("saveStreamDeltas flushes buffered parts (issue #323)", () => {
  test("deltas hold the full text when the generation outpaces the throttle", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "u1" }),
    );

    await t.action(testApi.streamTextThrottled, { threadId });
    await t.finishAllScheduledFunctions(() => {});

    const streams = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId,
        statuses: ["streaming", "finished", "aborted"],
      }),
    );
    const deltas = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.listDeltas, {
        threadId,
        cursors: streams.map((s) => ({ streamId: s.streamId, cursor: 0 })),
      }),
    );

    expect(streams).toHaveLength(1);
    expect(streams[0].status).toBe("finished");

    let cursor = 0;
    for (const delta of deltas) {
      expect(delta.start).toBe(cursor);
      cursor = delta.end;
    }

    const parts = deltas.flatMap((d) => d.parts);
    const types = parts.map((p) => p.type);
    expect(types.at(0)).toBe("start");
    expect(types).toContain("text-start");
    expect(types).toContain("text-end");
    // The stream-level "finish" chunk is emitted after the last step ends, so
    // it cannot exist yet; the row's finished status carries that instead.
    expect(types.at(-1)).toBe("finish-step");
    expect(types).not.toContain("finish");
    expect(
      parts
        .filter((p) => p.type === "text-delta")
        .map((p) => (p as { delta?: string }).delta ?? "")
        .join(""),
    ).toBe(FINAL_TEXT);
  });

  test("the awaited path captures the stream-level finish chunk", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "u1" }),
    );

    await t.action(testApi.streamTextThrottledAwaited, { threadId });
    await t.finishAllScheduledFunctions(() => {});

    const streams = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId,
        statuses: ["streaming", "finished", "aborted"],
      }),
    );
    const deltas = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.listDeltas, {
        threadId,
        cursors: streams.map((s) => ({ streamId: s.streamId, cursor: 0 })),
      }),
    );

    expect(streams).toHaveLength(1);
    expect(streams[0].status).toBe("finished");

    let cursor = 0;
    for (const delta of deltas) {
      expect(delta.start).toBe(cursor);
      cursor = delta.end;
    }

    const parts = deltas.flatMap((d) => d.parts);
    const types = parts.map((p) => p.type);
    // Unlike the returnImmediately path, nothing stops accepting parts early
    // here: consumeStream drains at EOF, so the trailing chunks the AI SDK
    // emits after the last onStepEnd are persisted too.
    expect(types.at(0)).toBe("start");
    expect(types.at(-1)).toBe("finish");
    expect(types).toContain("finish-step");
    expect(
      parts
        .filter((p) => p.type === "text-delta")
        .map((p) => (p as { delta?: string }).delta ?? "")
        .join(""),
    ).toBe(FINAL_TEXT);
  });
});

describe("stream finish ownership without message storage", () => {
  test("the row still terminates when saveMessages is none", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "u1" }),
    );

    await t.action(testApi.streamTextNoStorage, { threadId });
    await t.finishAllScheduledFunctions(() => {});

    const streams = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId,
        statuses: ["streaming", "finished", "aborted"],
      }),
    );
    expect(streams.map((s) => s.status)).toEqual(["finished"]);
  });

  test("the row still terminates on the returnImmediately path", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "u1" }),
    );

    await t.action(testApi.streamTextNoStorageImmediate, { threadId });
    await t.finishAllScheduledFunctions(() => {});

    const streams = await t.run(async (ctx) =>
      ctx.runQuery(components.agent.streams.list, {
        threadId,
        statuses: ["streaming", "finished", "aborted"],
      }),
    );
    expect(streams.map((s) => s.status)).toEqual(["finished"]);
  });
});
