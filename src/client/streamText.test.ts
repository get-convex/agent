import { describe, expect, test } from "vitest";
import { Agent, createThread } from "../vercel/index.js";
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
import { mockModel } from "../vercel/client/mockModel.js";

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

const testApi: ApiFromModules<{
  fns: {
    streamTextReturnImmediately: typeof streamTextReturnImmediately;
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
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
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
