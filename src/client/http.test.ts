import { describe, expect, test } from "vitest";
import { createThread, httpStreamText, httpStreamUIMessages } from "./index.js";
import {
  anyApi,
  actionGeneric,
  defineSchema,
  type DataModelFromSchemaDefinition,
} from "convex/server";
import type { ApiFromModules, ActionBuilder } from "convex/server";
import { components, initConvexTest } from "./setup.test.js";
import { mockModel } from "./mockModel.js";
import { streamText } from "./streamText.js";

const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

const model = () =>
  mockModel({
    content: [{ type: "text", text: "Hello from mock" }],
  });

// ============================================================================
// Test action exports — convex-test requires these to live in test files so
// that t.action(api...) can dispatch into them.
// ============================================================================

export const testStreamTextStreamId = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const result = await streamText(
      ctx,
      components.agent,
      { model: model(), prompt: "test prompt" },
      {
        agentName: "stream-test",
        threadId,
        saveStreamDeltas: { returnImmediately: true },
      },
    );
    // Drain the stream so the test can observe streamId after generation
    // is set up (but the stream itself may not be fully finished).
    for await (const _ of result.textStream) {
      // consume
    }
    return {
      streamId: result.streamId,
      promptMessageId: result.promptMessageId,
    };
  },
});

export const testStreamTextNoDeltas = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const result = await streamText(
      ctx,
      components.agent,
      { model: model(), prompt: "test prompt" },
      {
        agentName: "stream-test",
        threadId,
      },
    );
    for await (const _ of result.textStream) {
      // consume
    }
    return { streamId: result.streamId };
  },
});

export const testHttpStreamTextWithThread = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const response = await httpStreamText(
      ctx,
      components.agent,
      { model: model(), prompt: "Hello" },
      {
        agentName: "http-test",
        threadId,
      },
    );
    const text = await response.text();
    return {
      status: response.status,
      hasText: text.length > 0,
      hasMessageId: response.headers.has("X-Message-Id"),
      hasStreamId: response.headers.has("X-Stream-Id"),
    };
  },
});

export const testHttpStreamTextCreatesThread = action({
  args: {},
  handler: async (ctx) => {
    const response = await httpStreamText(
      ctx,
      components.agent,
      { model: model(), prompt: "Hello" },
      {
        agentName: "http-test",
        userId: "user-abc",
      },
    );
    const text = await response.text();
    return {
      status: response.status,
      hasText: text.length > 0,
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

export const testHttpStreamTextWithCors = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const response = await httpStreamText(
      ctx,
      components.agent,
      { model: model(), prompt: "Hello" },
      {
        agentName: "http-test",
        threadId,
        corsHeaders: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "X-Message-Id, X-Stream-Id",
        },
      },
    );
    await response.text();
    return {
      status: response.status,
      corsOrigin: response.headers.get("Access-Control-Allow-Origin"),
      corsExpose: response.headers.get("Access-Control-Expose-Headers"),
    };
  },
});

export const testHttpStreamTextSavesDeltas = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const response = await httpStreamText(
      ctx,
      components.agent,
      { model: model(), prompt: "Hello" },
      {
        agentName: "http-test",
        threadId,
        saveStreamDeltas: true,
      },
    );
    await response.text();
    return {
      status: response.status,
      hasStreamId: response.headers.has("X-Stream-Id"),
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

export const testHttpStreamUIMessages = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const response = await httpStreamUIMessages(
      ctx,
      components.agent,
      { model: model(), prompt: "Hello" },
      {
        agentName: "http-test",
        threadId,
      },
    );
    const text = await response.text();
    return {
      status: response.status,
      hasText: text.length > 0,
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

const testApi: ApiFromModules<{
  fns: {
    testStreamTextStreamId: typeof testStreamTextStreamId;
    testStreamTextNoDeltas: typeof testStreamTextNoDeltas;
    testHttpStreamTextWithThread: typeof testHttpStreamTextWithThread;
    testHttpStreamTextCreatesThread: typeof testHttpStreamTextCreatesThread;
    testHttpStreamTextWithCors: typeof testHttpStreamTextWithCors;
    testHttpStreamTextSavesDeltas: typeof testHttpStreamTextSavesDeltas;
    testHttpStreamUIMessages: typeof testHttpStreamUIMessages;
  };
}>["fns"] = anyApi["http.test"] as any;

// ============================================================================
// Tests
// ============================================================================

describe("streamText streamId metadata", () => {
  test("returns streamId when saveStreamDeltas is enabled", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testStreamTextStreamId, {});
    expect(result.streamId).toBeDefined();
    expect(result.promptMessageId).toBeDefined();
  });

  test("streamId is undefined when saveStreamDeltas is not set", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testStreamTextNoDeltas, {});
    expect(result.streamId).toBeUndefined();
  });
});

describe("httpStreamText", () => {
  test("streams text and sets X-Message-Id header", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testHttpStreamTextWithThread, {});
    expect(result.status).toBe(200);
    expect(result.hasText).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });

  test("creates a thread when threadId is omitted", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testHttpStreamTextCreatesThread, {});
    expect(result.status).toBe(200);
    expect(result.hasText).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });

  test("applies corsHeaders to the response", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testHttpStreamTextWithCors, {});
    expect(result.status).toBe(200);
    expect(result.corsOrigin).toBe("*");
    expect(result.corsExpose).toBe("X-Message-Id, X-Stream-Id");
  });

  test("sets X-Stream-Id when saveStreamDeltas is enabled", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testHttpStreamTextSavesDeltas, {});
    expect(result.status).toBe(200);
    expect(result.hasStreamId).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });
});

describe("httpStreamUIMessages", () => {
  test("returns a UI message stream response", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testHttpStreamUIMessages, {});
    expect(result.status).toBe(200);
    expect(result.hasText).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });
});
