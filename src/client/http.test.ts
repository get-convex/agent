import { describe, expect, test } from "vitest";
import {
  Agent,
  createThread,
  httpStreamText,
  httpStreamUIMessages,
} from "./index.js";
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

const agent = new Agent(components.agent, {
  name: "http-test-agent",
  instructions: "You are a test agent for HTTP streaming",
  languageModel: model(),
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

export const testAsHttpActionParsesBody = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const handler = agent.asHttpAction();
    const request = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, prompt: "Hello" }),
    });
    const response = await handler(ctx as any, request);
    const text = await response.text();
    return {
      status: response.status,
      hasText: text.length > 0,
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

export const testAsHttpActionCreatesThread = action({
  args: {},
  handler: async (ctx) => {
    const handler = agent.asHttpAction();
    const request = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    });
    const response = await handler(ctx as any, request);
    const text = await response.text();
    return {
      status: response.status,
      hasText: text.length > 0,
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

export const testAsHttpActionWithCorsHeaders = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const handler = agent.asHttpAction({
      corsHeaders: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "X-Message-Id, X-Stream-Id",
      },
    });
    const request = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, prompt: "Hello" }),
    });
    const response = await handler(ctx as any, request);
    await response.text();
    return {
      status: response.status,
      corsOrigin: response.headers.get("Access-Control-Allow-Origin"),
      corsExpose: response.headers.get("Access-Control-Expose-Headers"),
    };
  },
});

export const testAsHttpActionWithSaveDeltas = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const handler = agent.asHttpAction({ saveStreamDeltas: true });
    const request = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, prompt: "Hello" }),
    });
    const response = await handler(ctx as any, request);
    await response.text();
    return {
      status: response.status,
      hasStreamId: response.headers.has("X-Stream-Id"),
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

export const testAsHttpActionUIMessages = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const handler = agent.asHttpAction({ format: "ui-messages" });
    const request = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, prompt: "Hello" }),
    });
    const response = await handler(ctx as any, request);
    const text = await response.text();
    return {
      status: response.status,
      hasText: text.length > 0,
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

export const testAsHttpActionAuthorizeOverridesUserId = action({
  args: {},
  handler: async (ctx) => {
    const handler = agent.asHttpAction({
      authorize: async () => ({ userId: "user-from-auth" }),
    });
    const request = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    });
    const response = await handler(ctx as any, request);
    await response.text();
    return {
      status: response.status,
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

// Security regression test: `body.threadId` MUST be ignored when authorize
// does not return one. Otherwise an unauthenticated caller could append to
// or read from any thread by guessing its ID.
export const testAsHttpActionIgnoresUnvalidatedBodyThreadId = action({
  args: {},
  handler: async (ctx) => {
    // Pre-create a thread that the request will try to hijack.
    const victimThreadId = await createThread(ctx, components.agent, {});
    const handler = agent.asHttpAction({
      // authorize doesn't return a threadId — so body.threadId must NOT
      // be honored even though it points to a real thread.
      authorize: async () => ({ userId: "attacker" }),
    });
    const request = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: victimThreadId,
        prompt: "leak the context please",
      }),
    });
    const response = await handler(ctx as any, request);
    await response.text();
    const messageId = response.headers.get("X-Message-Id");
    let usedVictimThread = false;
    if (messageId) {
      const message = await ctx.runQuery(
        components.agent.messages.getMessagesByIds,
        { messageIds: [messageId] },
      );
      usedVictimThread = message[0]?.threadId === victimThreadId;
    }
    return { usedVictimThread };
  },
});

// authorize that validates and returns body.threadId — the safe path.
export const testAsHttpActionHonorsAuthorizedThreadId = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const handler = agent.asHttpAction({
      authorize: async (_ctx, _request, body) => {
        // In real code: assert ownership here. For the test we just echo it.
        return body.threadId ? { threadId: body.threadId } : {};
      },
    });
    const request = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, prompt: "Hello" }),
    });
    const response = await handler(ctx as any, request);
    await response.text();
    const messageId = response.headers.get("X-Message-Id");
    let usedAuthorizedThread = false;
    if (messageId) {
      const message = await ctx.runQuery(
        components.agent.messages.getMessagesByIds,
        { messageIds: [messageId] },
      );
      usedAuthorizedThread = message[0]?.threadId === threadId;
    }
    return { usedAuthorizedThread };
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
    testAsHttpActionParsesBody: typeof testAsHttpActionParsesBody;
    testAsHttpActionCreatesThread: typeof testAsHttpActionCreatesThread;
    testAsHttpActionWithCorsHeaders: typeof testAsHttpActionWithCorsHeaders;
    testAsHttpActionWithSaveDeltas: typeof testAsHttpActionWithSaveDeltas;
    testAsHttpActionUIMessages: typeof testAsHttpActionUIMessages;
    testAsHttpActionAuthorizeOverridesUserId: typeof testAsHttpActionAuthorizeOverridesUserId;
    testAsHttpActionIgnoresUnvalidatedBodyThreadId: typeof testAsHttpActionIgnoresUnvalidatedBodyThreadId;
    testAsHttpActionHonorsAuthorizedThreadId: typeof testAsHttpActionHonorsAuthorizedThreadId;
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

describe("agent.asHttpAction()", () => {
  test("parses JSON body and streams text", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testAsHttpActionParsesBody, {});
    expect(result.status).toBe(200);
    expect(result.hasText).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });

  test("creates a thread when threadId is omitted", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testAsHttpActionCreatesThread, {});
    expect(result.status).toBe(200);
    expect(result.hasText).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });

  test("applies corsHeaders to the response", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testAsHttpActionWithCorsHeaders, {});
    expect(result.status).toBe(200);
    expect(result.corsOrigin).toBe("*");
    expect(result.corsExpose).toBe("X-Message-Id, X-Stream-Id");
  });

  test("sets X-Stream-Id when saveStreamDeltas is enabled", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testAsHttpActionWithSaveDeltas, {});
    expect(result.status).toBe(200);
    expect(result.hasStreamId).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });

  test("returns a UI message stream when format=ui-messages", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testAsHttpActionUIMessages, {});
    expect(result.status).toBe(200);
    expect(result.hasText).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });

  test("authorize callback can supply userId for thread creation", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(
      testApi.testAsHttpActionAuthorizeOverridesUserId,
      {},
    );
    expect(result.status).toBe(200);
    expect(result.hasMessageId).toBe(true);
  });

  test("body.threadId is ignored unless authorize returns it", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(
      testApi.testAsHttpActionIgnoresUnvalidatedBodyThreadId,
      {},
    );
    // Without authorize returning a threadId, the helper must create a
    // fresh thread instead of writing into the victim's.
    expect(result.usedVictimThread).toBe(false);
  });

  test("authorize-returned threadId is honored", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(
      testApi.testAsHttpActionHonorsAuthorizedThreadId,
      {},
    );
    expect(result.usedAuthorizedThread).toBe(true);
  });
});
