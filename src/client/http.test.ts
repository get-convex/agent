import { describe, expect, test } from "vitest";
import { Agent, createThread } from "./index.js";
import {
  anyApi,
  actionGeneric,
  defineSchema,
  type DataModelFromSchemaDefinition,
} from "convex/server";
import type { ApiFromModules, ActionBuilder } from "convex/server";
import { components, initConvexTest } from "./setup.test.js";
import { mockModel } from "./mockModel.js";
import { generateText } from "./generateText.js";
import { streamText } from "./streamText.js";

const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

const model = mockModel({
  content: [{ type: "text", text: "Hello from mock" }],
});

const agent = new Agent(components.agent, {
  name: "test-http",
  instructions: "You are a test agent for HTTP streaming",
  languageModel: model,
});

// ============================================================================
// Exported test actions (used by convex-test)
// ============================================================================

export const testStreamTextStandalone = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const result = await streamText(
      ctx,
      components.agent,
      {
        model: mockModel({
          content: [{ type: "text", text: "standalone stream text" }],
        }),
        prompt: "test prompt",
      },
      {
        agentName: "standalone-test",
        threadId,
        saveStreamDeltas: true,
      },
    );
    await result.consumeStream();
    return {
      text: await result.text,
      promptMessageId: result.promptMessageId,
      streamId: result.streamId,
      order: result.order,
    };
  },
});

export const testStreamTextWithoutDeltas = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const result = await streamText(
      ctx,
      components.agent,
      {
        model: mockModel({
          content: [{ type: "text", text: "no deltas stream" }],
        }),
        prompt: "test prompt",
      },
      {
        agentName: "standalone-test",
        threadId,
      },
    );
    await result.consumeStream();
    return {
      text: await result.text,
      promptMessageId: result.promptMessageId,
      streamId: result.streamId,
      order: result.order,
    };
  },
});

export const testGenerateTextStandalone = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const result = await generateText(
      ctx,
      components.agent,
      {
        model: mockModel({
          content: [{ type: "text", text: "standalone generate text" }],
        }),
        prompt: "test prompt",
      },
      {
        agentName: "standalone-test",
        threadId,
      },
    );
    return {
      text: result.text,
      promptMessageId: result.promptMessageId,
      order: result.order,
    };
  },
});

export const testAgentGenerateTextDelegation = action({
  args: {},
  handler: async (ctx) => {
    const { thread } = await agent.createThread(ctx, { userId: "user1" });
    const result = await thread.generateText({
      prompt: "test prompt",
    });
    return {
      text: result.text,
      promptMessageId: result.promptMessageId,
      order: result.order,
      savedMessages: result.savedMessages?.map((m) => m._id),
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
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

export const testAsHttpActionWithSaveDeltas = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const handler = agent.asHttpAction({
      saveStreamDeltas: true,
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
      hasStreamId: response.headers.has("X-Stream-Id"),
      hasMessageId: response.headers.has("X-Message-Id"),
    };
  },
});

export const testAsHttpActionUIMessages = action({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent, {});
    const handler = agent.asHttpAction({
      format: "ui-messages",
    });
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
      // UI message stream format is different from plain text (it contains
      // structured data, not just the raw text)
      textDiffers: !text.includes("Hello from mock") || text.length > "Hello from mock".length,
    };
  },
});

const testApi: ApiFromModules<{
  fns: {
    testStreamTextStandalone: typeof testStreamTextStandalone;
    testStreamTextWithoutDeltas: typeof testStreamTextWithoutDeltas;
    testGenerateTextStandalone: typeof testGenerateTextStandalone;
    testAgentGenerateTextDelegation: typeof testAgentGenerateTextDelegation;
    testAsHttpActionParsesBody: typeof testAsHttpActionParsesBody;
    testAsHttpActionCreatesThread: typeof testAsHttpActionCreatesThread;
    testAsHttpActionWithCorsHeaders: typeof testAsHttpActionWithCorsHeaders;
    testAsHttpActionWithSaveDeltas: typeof testAsHttpActionWithSaveDeltas;
    testAsHttpActionUIMessages: typeof testAsHttpActionUIMessages;
  };
}>["fns"] = anyApi["http.test"] as any;

// ============================================================================
// Tests
// ============================================================================

describe("Standalone streamText", () => {
  test("returns streamId when saveStreamDeltas is enabled", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testStreamTextStandalone, {});
    expect(result.text).toBe("standalone stream text");
    expect(result.promptMessageId).toBeDefined();
    expect(result.streamId).toBeDefined();
    expect(result.order).toBeTypeOf("number");
  });

  test("streamId is undefined when saveStreamDeltas is not set", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testStreamTextWithoutDeltas, {});
    expect(result.text).toBe("no deltas stream");
    expect(result.streamId).toBeUndefined();
  });
});

describe("Standalone generateText", () => {
  test("generates text and returns metadata", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testGenerateTextStandalone, {});
    expect(result.text).toBe("standalone generate text");
    expect(result.promptMessageId).toBeDefined();
    expect(result.order).toBeTypeOf("number");
  });
});

describe("Agent.generateText delegation to standalone", () => {
  test("agent.generateText delegates correctly", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(
      testApi.testAgentGenerateTextDelegation,
      {},
    );
    expect(result.text).toBe("Hello from mock");
    expect(result.promptMessageId).toBeDefined();
    expect(result.savedMessages).toBeDefined();
    expect(result.savedMessages!.length).toBeGreaterThan(0);
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

  test("creates thread when not provided in body", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(
      testApi.testAsHttpActionCreatesThread,
      {},
    );
    expect(result.status).toBe(200);
    expect(result.hasText).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });

  test("adds CORS headers when corsHeaders is specified", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(
      testApi.testAsHttpActionWithCorsHeaders,
      {},
    );
    expect(result.status).toBe(200);
    expect(result.corsOrigin).toBe("*");
    expect(result.corsExpose).toBe("X-Message-Id, X-Stream-Id");
    expect(result.hasMessageId).toBe(true);
  });

  test("sets X-Stream-Id when saveStreamDeltas is enabled", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(
      testApi.testAsHttpActionWithSaveDeltas,
      {},
    );
    expect(result.status).toBe(200);
    expect(result.hasStreamId).toBe(true);
    expect(result.hasMessageId).toBe(true);
  });

  test("returns UI message stream format when format is ui-messages", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.testAsHttpActionUIMessages, {});
    expect(result.status).toBe(200);
    expect(result.hasText).toBe(true);
    expect(result.hasMessageId).toBe(true);
    expect(result.textDiffers).toBe(true);
  });
});
