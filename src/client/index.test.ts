import { describe, expect, test } from "vitest";
import {
  Agent,
  filterOutOrphanedToolMessages,
  type MessageDoc,
} from "./index.js";
import type { DataModelFromSchemaDefinition } from "convex/server";
import {
  anyApi,
  queryGeneric,
  mutationGeneric,
  actionGeneric,
} from "convex/server";
import type {
  ApiFromModules,
  ActionBuilder,
  MutationBuilder,
  QueryBuilder,
} from "convex/server";
import { v } from "convex/values";
import { defineSchema } from "convex/server";
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModelV2, LanguageModelV2StreamPart } from "ai";
import { simulateReadableStream } from "ai";
import { components, initConvexTest } from "./setup.test.js";
import { z } from "zod";

const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
// type DatabaseReader = GenericDatabaseReader<DataModel>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

const agent = new Agent(components.agent, {
  name: "test",
  instructions: "You are a test agent",
  // TODO: get mock model that works in v8
  chat: mockModel(),
});

export const testQuery = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return await agent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: {
        cursor: null,
        numItems: 10,
      },
      excludeToolMessages: true,
      statuses: ["success"],
    });
  },
});

export const createThread = mutation({
  args: {},
  handler: async (ctx) => {
    const { threadId } = await agent.createThread(ctx, {
      userId: "1",
    });
    return { threadId };
  },
});

export const createThreadMutation = agent.createThreadMutation();
export const generateObjectAction = agent.asObjectAction({
  schema: z.object({
    prompt: z.any().describe("The prompt passed in"),
  }),
});
export const generateTextAction = agent.asTextAction({});
export const streamTextAction = agent.asTextAction({ stream: true });
export const saveMessageMutation = agent.asSaveMessagesMutation();

export const createAndGenerate = action({
  args: {},
  handler: async (ctx) => {
    const { thread } = await agent.createThread(ctx, {
      userId: "1",
    });
    const result = await thread.generateText({
      messages: [{ role: "user", content: "Hello" }],
    });
    return result.text;
  },
});

export const continueThreadAction = action({
  args: { threadId: v.string(), userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { thread } = await agent.continueThread(ctx, args);
    return { threadId: thread.threadId };
  },
});

export const generateTextWithThread = action({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    messages: v.array(v.any()),
    contextOptions: v.optional(v.any()),
    storageOptions: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { thread } = await agent.continueThread(ctx, {
      threadId: args.threadId,
      userId: args.userId,
    });
    const result = await thread.generateText(
      { messages: args.messages },
      {
        contextOptions: args.contextOptions,
        storageOptions: args.storageOptions,
      },
    );
    return { text: result.text };
  },
});

export const generateObjectWithThread = action({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const { thread } = await agent.continueThread(ctx, {
      threadId: args.threadId,
      userId: args.userId,
    });
    const result = await thread.generateObject({
      prompt: args.prompt,
      schema: z.object({ prompt: z.any() }),
    });
    return { object: result.object };
  },
});

export const fetchContextAction = action({
  args: {
    userId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    messages: v.array(v.any()),
    contextOptions: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const context = await agent.fetchContextMessages(ctx, {
      userId: args.userId,
      threadId: args.threadId,
      messages: args.messages,
      contextOptions: args.contextOptions,
    });
    return context;
  },
});

const testApi: ApiFromModules<{
  fns: {
    createAndGenerate: typeof createAndGenerate;
    createThread: typeof createThread;
    testQuery: typeof testQuery;
    continueThreadAction: typeof continueThreadAction;
    generateTextWithThread: typeof generateTextWithThread;
    generateObjectWithThread: typeof generateObjectWithThread;
    fetchContextAction: typeof fetchContextAction;
    generateTextAction: typeof generateTextAction;
    generateObjectAction: typeof generateObjectAction;
    saveMessageMutation: typeof saveMessageMutation;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}>["fns"] = anyApi["index.test"] as any;

describe("Agent thick client", () => {
  test("should create a thread", async () => {
    const t = initConvexTest(schema);
    const result = await t.mutation(testApi.createThread, {});
    expect(result.threadId).toBeTypeOf("string");
  });
  test("should create a thread and generate text", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.createAndGenerate, {});
    expect(result).toBeDefined();
    expect(result).toMatch("Hello");
  });
});

describe("filterOutOrphanedToolMessages", () => {
  const call1: MessageDoc = {
    _id: "call1",
    _creationTime: Date.now(),
    order: 1,
    stepOrder: 1,
    tool: true,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "1",
          toolName: "tool1",
          args: { test: "test" },
        },
      ],
    },
    status: "success",
    threadId: "1",
  };
  const response1: MessageDoc = {
    _id: "response1",
    _creationTime: Date.now(),
    order: 1,
    stepOrder: 1,
    tool: true,
    message: {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "1",
          toolName: "tool1",
          result: { test: "test" },
        },
      ],
    },
    status: "success",
    threadId: "1",
  };
  const call2: MessageDoc = {
    _id: "call2",
    _creationTime: Date.now(),
    order: 1,
    stepOrder: 2,
    tool: true,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
    },
    status: "success",
    threadId: "1",
  };
  test("should not filter out extra tool calls", () => {
    expect(filterOutOrphanedToolMessages([call1, response1, call2])).toEqual([
      call1,
      response1,
      call2,
    ]);
  });
  test("should filter out extra tool calls", () => {
    expect(filterOutOrphanedToolMessages([response1, call2])).toEqual([call2]);
  });
});

function mockModel(): LanguageModelV2 {
  return new MockLanguageModelV2({
    provider: "mock",
    modelId: "mock",
    defaultObjectGenerationMode: "json",
    // supportsStructuredOutputs: true,
    doGenerate: async ({ prompt }) => ({
      finishReason: "stop",
      usage: { completionTokens: 10, promptTokens: 3 },
      logprobs: undefined,
      rawCall: { rawPrompt: null, rawSettings: {} },
      text: JSON.stringify({ prompt }),
    }),
    doStream: async ({ prompt }) => ({
      stream: simulateReadableStream({
        chunkDelayInMs: 50,
        initialDelayInMs: 100,
        chunks: [
          {
            type: "text-delta",
            textDelta: `This is a sample response to ${JSON.stringify(prompt)}`,
          },
          {
            type: "finish",
            finishReason: "stop",
            logprobs: undefined,
            usage: { completionTokens: 10, promptTokens: 3 },
          },
        ] as LanguageModelV2StreamPart[],
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });
}

describe("Agent option variations and normal behavior", () => {
  test("Agent can be constructed with minimal options", () => {
    const a = new Agent(components.agent, { chat: mockModel() });
    expect(a).toBeInstanceOf(Agent);
  });

  test("Agent can be constructed with all options", () => {
    const a = new Agent(components.agent, {
      name: "full",
      chat: mockModel(),
      instructions: "Test instructions",
      contextOptions: { recentMessages: 5 },
      storageOptions: { saveMessages: "all" },
      stopWhen: stepCountIs(2),
      maxRetries: 1,
      usageHandler: async () => {},
      rawRequestResponseHandler: async () => {},
    });
    expect(a.options.name).toBe("full");
  });
});

describe("Agent thread management", () => {
  test("createThread returns threadId (mutation context)", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      agent.createThread(ctx, { userId: "2" }).then(({ threadId }) => threadId),
    );
    expect(threadId).toBeTypeOf("string");
  });

  test("continueThread returns thread object", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      agent.createThread(ctx, { userId: "3" }).then(({ threadId }) => threadId),
    );
    const result = await t.action(testApi.continueThreadAction, {
      threadId,
      userId: "3",
    });
    expect(result.threadId).toBe(threadId);
  });
});

describe("Agent message operations", () => {
  test("saveMessage and saveMessages store messages", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      agent.createThread(ctx, { userId: "4" }).then(({ threadId }) => threadId),
    );
    const { messageId } = await t.run(async (ctx) =>
      agent.saveMessage(ctx, {
        threadId,
        userId: "4",
        message: { role: "user", content: "Hello" },
      }),
    );
    expect(messageId).toBeTypeOf("string");

    const { lastMessageId, messages } = await t.run(async (ctx) =>
      agent.saveMessages(ctx, {
        threadId,
        userId: "4",
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello!" },
        ],
      }),
    );
    expect(messages.length).toBe(2);
    expect(lastMessageId).toBe(messages[1]._id);
  });
});

describe("Agent text/object generation", () => {
  test("generateText with custom context and storage options", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      agent.createThread(ctx, { userId: "5" }).then(({ threadId }) => threadId),
    );
    const result = await t.action(testApi.generateTextWithThread, {
      threadId,
      userId: "5",
      messages: [{ role: "user", content: "Test" }],
      contextOptions: { recentMessages: 1 },
      storageOptions: { saveMessages: "all" },
    });
    expect(result.text).toMatch(/Test/);
  });

  test("generateObject returns object", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      agent.createThread(ctx, { userId: "6" }).then(({ threadId }) => threadId),
    );
    const result = await t.action(testApi.generateObjectWithThread, {
      threadId,
      userId: "6",
      prompt: "Object please",
    });
    expect(result.object).toBeDefined();
  });
});

describe("Agent-generated mutations/actions/queries", () => {
  test("createThreadMutation works via t.mutation", async () => {
    const t = initConvexTest(schema);
    // This test is for the registered mutation, not the agent method
    const result = await t.mutation(testApi.createThread, {});
    expect(result.threadId).toBeTypeOf("string");
  });

  test("asTextAction and asObjectAction work via t.action", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      agent.createThread(ctx, { userId: "8" }).then(({ threadId }) => threadId),
    );
    const textResult = await t.action(testApi.generateTextAction, {
      userId: "8",
      threadId,
      messages: [{ role: "user", content: "Say hi" }],
    });
    expect(textResult.text).toMatch(/Say hi/);

    const objResult = await t.action(testApi.generateObjectAction, {
      userId: "8",
      threadId,
      messages: [{ role: "user", content: "Give object" }],
    });
    expect(objResult.object).toBeDefined();
  });

  test("asSaveMessagesMutation works via t.mutation", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      agent.createThread(ctx, { userId: "9" }).then(({ threadId }) => threadId),
    );
    const result = await t.mutation(testApi.saveMessageMutation, {
      threadId,
      messages: [
        {
          message: { role: "user", content: "Saved via mutation" },
          // add more metadata fields as needed
        },
      ],
    });
    expect(result.lastMessageId).toBeDefined();
    expect(result.messageIds.length).toBe(1);
  });
});

describe("Agent context and search options", () => {
  test("fetchContextMessages returns context messages", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      agent
        .createThread(ctx, { userId: "10" })
        .then(({ threadId }) => threadId),
    );
    await t.run(async (ctx) =>
      agent.saveMessage(ctx, {
        threadId,
        userId: "10",
        message: { role: "user", content: "Context test" },
      }),
    );
    const context = await t.action(testApi.fetchContextAction, {
      userId: "10",
      threadId,
      messages: [{ role: "user", content: "Context test" }],
      contextOptions: { recentMessages: 1 },
    });
    expect(context.length).toBeGreaterThan(0);
  });
});
