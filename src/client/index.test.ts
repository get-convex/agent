import { describe, expect, test } from "vitest";
import {
  Agent,
  createThread,
  createTool,
  filterOutOrphanedToolMessages,
  type MessageDoc,
} from "../vercel/index.js";
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
import { isStepCount } from "ai";
import { components, initConvexTest } from "./setup.test.js";
import { z } from "zod/v4";
import { MockLanguageModel, mockModel } from "../vercel/client/mockModel.js";

const schema = defineSchema({});
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
// type DatabaseReader = GenericDatabaseReader<DataModel>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
const action = actionGeneric as ActionBuilder<DataModel, "public">;

const TEST_TEXT = JSON.stringify({ hello: "world" });

const agent = new Agent(components.agent, {
  name: "test",
  instructions: "You are a test agent",
  languageModel: mockModel({
    content: [{ type: "text", text: TEST_TEXT }],
  }),
});

export const testQuery = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return await agent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: { cursor: null, numItems: 10 },
      excludeToolMessages: true,
      statuses: ["success"],
    });
  },
});

export const createThreadManually = mutation({
  args: {},
  handler: async (ctx) => {
    const { threadId } = await agent.createThread(ctx, { userId: "1" });
    return { threadId };
  },
});

const saveStepAgent = new Agent(components.agent, {
  name: "save-step-test",
  instructions: "test",
  tools: {
    echo: createTool({
      description: "Echo a value",
      inputSchema: z.object({ value: z.string() }),
      execute: async (_ctx, input) => `echo:${input.value}`,
    }),
  },
  languageModel: mockModel({
    contentSteps: [
      [
        {
          type: "tool-call",
          toolCallId: "ss-1",
          toolName: "echo",
          input: JSON.stringify({ value: "hi" }),
        },
      ],
      [{ type: "text", text: "done" }],
    ],
  }),
  stopWhen: isStepCount(5),
});

let boundaryOnStepEndCalls = 0;
let boundaryOnStepFinishCalls = 0;
let boundaryThrowingCallbackCalls = 0;
let boundaryRawRequestBody: unknown;
let boundaryRawResponseBody: unknown;
const boundaryModel = new MockLanguageModel({
  doGenerate: async () => ({
    content: [{ type: "text", text: "boundary-ok" }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
    request: { body: { requestIncluded: true } },
    response: {
      headers: {},
      body: { responseIncluded: true },
    },
  }),
});
const boundaryAgent = new Agent(components.agent, {
  name: "v7-boundary",
  instructions: "agent instructions",
  languageModel: boundaryModel,
  rawRequestResponseHandler: async (_ctx, { request, response }) => {
    boundaryRawRequestBody = request.body;
    boundaryRawResponseBody = response.body;
  },
});

let observedToolContext: string | undefined;
let observedRuntimeContext: string | undefined;
const contextualTool = createTool({
  inputSchema: z.object({ value: z.string() }),
  contextSchema: z.object({ tenantId: z.string() }),
  execute: async (_ctx, input, { context }) => {
    observedToolContext = `${context.tenantId}:${input.value}`;
    return observedToolContext;
  },
});
const contextAgent = new Agent(components.agent, {
  name: "v7-context",
  languageModel: mockModel({
    contentSteps: [
      [
        {
          type: "tool-call",
          toolCallId: "context-call",
          toolName: "contextualTool",
          input: JSON.stringify({ value: "hello" }),
        },
      ],
      [{ type: "text", text: "context-ok" }],
    ],
  }),
  tools: { contextualTool },
  stopWhen: isStepCount(2),
});

const emptyResponseAgent = new Agent(components.agent, {
  name: "empty-response-test",
  languageModel: mockModel({ content: [] }),
});

export const replayStepsViaSaveStep = action({
  args: { withWatermark: v.boolean() },
  handler: async (ctx, args) => {
    const { thread } = await saveStepAgent.createThread(ctx, {
      userId: "ss-gen",
    });
    const genResult = await thread.generateText({ prompt: "echo hi" });
    const steps = genResult.steps;

    const { threadId } = await saveStepAgent.createThread(ctx, {
      userId: "ss-replay",
    });
    const { messageId: promptMessageId } = await saveStepAgent.saveMessage(
      ctx,
      {
        threadId,
        message: { role: "user", content: "echo hi" },
        skipEmbeddings: true,
      },
    );
    let previousStep: (typeof steps)[number] | undefined;
    for (const step of steps) {
      await saveStepAgent.saveStep(ctx, {
        threadId,
        promptMessageId,
        step,
        previousStep: args.withWatermark ? previousStep : undefined,
      });
      previousStep = step;
    }

    const replayed = await saveStepAgent.listMessages(ctx, {
      threadId,
      paginationOpts: { cursor: null, numItems: 50 },
      statuses: ["success", "pending", "failed"],
    });
    const contentTypes = replayed.page.flatMap((m) =>
      Array.isArray(m.message?.content)
        ? m.message!.content.map((c: { type?: string }) => c.type ?? "text")
        : ["text"],
    );
    return { stepCount: steps.length, contentTypes };
  },
});

export const persistMultiStep = action({
  args: { stream: v.boolean() },
  handler: async (ctx, { stream }) => {
    const { threadId, thread } = await saveStepAgent.createThread(ctx, {
      userId: stream ? "ss-stream" : "ss-generate",
    });
    if (stream) {
      const result = await thread.streamText({ prompt: "echo hi" });
      await result.consumeStream();
    } else {
      await thread.generateText({ prompt: "echo hi" });
    }

    const persisted = await saveStepAgent.listMessages(ctx, {
      threadId,
      paginationOpts: { cursor: null, numItems: 50 },
      statuses: ["success", "pending", "failed"],
    });
    return persisted.page.flatMap((message) =>
      Array.isArray(message.message?.content)
        ? message.message.content.map((part) => part.type)
        : [message.message?.role === "assistant" ? "text" : "user"],
    );
  },
});

export const persistEmptyResponse = action({
  args: {},
  handler: async (ctx) => {
    const { threadId, thread } = await emptyResponseAgent.createThread(ctx, {
      userId: "empty-response",
    });
    await thread.generateText({ prompt: "return nothing" });
    const persisted = await emptyResponseAgent.listMessages(ctx, {
      threadId,
      paginationOpts: { cursor: null, numItems: 10 },
      statuses: ["success", "pending", "failed"],
    });
    return persisted.page.map((message) => ({
      role: message.message?.role,
      content: message.message?.content,
      status: message.status,
    }));
  },
});

export const exerciseV7Boundary = action({
  args: {},
  handler: async (ctx) => {
    boundaryOnStepEndCalls = 0;
    boundaryOnStepFinishCalls = 0;
    boundaryThrowingCallbackCalls = 0;
    boundaryRawRequestBody = undefined;
    boundaryRawResponseBody = undefined;
    boundaryModel.doGenerateCalls.length = 0;

    const { threadId, thread } = await boundaryAgent.createThread(ctx, {
      userId: "v7-boundary",
    });
    await boundaryAgent.saveMessage(ctx, {
      threadId,
      message: { role: "system", content: "stored instructions" },
      skipEmbeddings: true,
    });
    await thread.generateText({
      prompt: "hello",
      instructions: "request instructions",
      onStepEnd: () => {
        boundaryOnStepEndCalls += 1;
      },
    });
    const providerPrompt = boundaryModel.doGenerateCalls.at(-1)?.prompt ?? [];
    await thread.generateText({
      prompt: "legacy callback",
      onStepFinish: () => {
        boundaryOnStepFinishCalls += 1;
      },
    });
    try {
      await thread.generateText({
        prompt: "callback error",
        onStepEnd: () => {
          boundaryThrowingCallbackCalls += 1;
          throw new Error("onStepEnd failed");
        },
      });
    } catch {
      // Callback errors may propagate depending on the AI SDK callback policy.
    }
    const messages = await boundaryAgent.listMessages(ctx, {
      threadId,
      paginationOpts: { cursor: null, numItems: 20 },
      statuses: ["success", "pending", "failed"],
    });
    return {
      boundaryOnStepEndCalls,
      boundaryOnStepFinishCalls,
      boundaryThrowingCallbackCalls,
      hasStoredSystemMessage: providerPrompt.some(
        (message) =>
          message.role === "system" &&
          message.content === "stored instructions",
      ),
      hasRequestInstructions: providerPrompt.some(
        (message) =>
          message.role === "system" &&
          message.content === "request instructions",
      ),
      rawRequestIncluded:
        (boundaryRawRequestBody as { requestIncluded?: boolean } | undefined)
          ?.requestIncluded === true,
      rawResponseIncluded:
        (boundaryRawResponseBody as { responseIncluded?: boolean } | undefined)
          ?.responseIncluded === true,
      assistantMessages: messages.page.filter(
        (message) => message.message?.role === "assistant",
      ).length,
      pendingMessages: messages.page.filter(
        (message) => message.status === "pending",
      ).length,
    };
  },
});

export const exerciseV7Contexts = action({
  args: {},
  handler: async (ctx) => {
    observedToolContext = undefined;
    observedRuntimeContext = undefined;
    const { thread } = await contextAgent.createThread(ctx, {
      userId: "v7-context",
    });
    await thread.generateText({
      prompt: "use context",
      runtimeContext: { requestId: "request-ctx" },
      toolsContext: { contextualTool: { tenantId: "tenant-ctx" } },
      prepareStep: ({ runtimeContext }) => {
        observedRuntimeContext = runtimeContext.requestId;
        return {};
      },
    });
    return { observedToolContext, observedRuntimeContext };
  },
});

export const createThreadMutation = agent.createThreadMutation();
export const generateObjectAction = agent.asObjectAction({
  schema: z.object({ hello: z.string().describe("A string for testing") }),
});
export const generateTextAction = agent.asTextAction({});
export const streamTextAction = agent.asTextAction({ stream: true });
export const saveMessageMutation = agent.asSaveMessagesMutation();

export const createAndGenerate = action({
  args: {},
  handler: async (ctx) => {
    const { thread } = await agent.createThread(ctx, { userId: "1" });
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
    createThreadManually: typeof createThreadManually;
    testQuery: typeof testQuery;
    continueThreadAction: typeof continueThreadAction;
    generateTextWithThread: typeof generateTextWithThread;
    generateObjectWithThread: typeof generateObjectWithThread;
    fetchContextAction: typeof fetchContextAction;
    generateTextAction: typeof generateTextAction;
    generateObjectAction: typeof generateObjectAction;
    saveMessageMutation: typeof saveMessageMutation;
    replayStepsViaSaveStep: typeof replayStepsViaSaveStep;
    persistMultiStep: typeof persistMultiStep;
    persistEmptyResponse: typeof persistEmptyResponse;
    exerciseV7Boundary: typeof exerciseV7Boundary;
    exerciseV7Contexts: typeof exerciseV7Contexts;
  };
}>["fns"] = anyApi["index.test"] as any;

describe("Agent thick client", () => {
  test("should create a thread", async () => {
    const t = initConvexTest(schema);
    const result = await t.mutation(testApi.createThreadManually, {});
    expect(result.threadId).toBeTypeOf("string");
  });
  test("should create a thread and generate text", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.createAndGenerate, {});
    expect(result).toBeDefined();
    expect(result).toMatch(TEST_TEXT);
  });
  test("saveStep with previousStep saves each step's new messages exactly once", async () => {
    const t = initConvexTest(schema);
    const res = await t.action(testApi.replayStepsViaSaveStep, {
      withWatermark: true,
    });
    expect(res.stepCount).toBe(2);
    const toolCalls = res.contentTypes.filter((t) => t === "tool-call").length;
    const toolResults = res.contentTypes.filter(
      (t) => t === "tool-result",
    ).length;
    expect(toolCalls).toBe(1);
    expect(toolResults).toBe(1);
  });
  test("saveStep does not need previousStep with AI SDK v7", async () => {
    const t = initConvexTest(schema);
    const res = await t.action(testApi.replayStepsViaSaveStep, {
      withWatermark: false,
    });
    const toolCalls = res.contentTypes.filter((t) => t === "tool-call").length;
    expect(toolCalls).toBe(1);
  });
  test.each([
    ["generateText", false],
    ["streamText", true],
  ])(
    "%s persists every multi-step response exactly once",
    async (_, stream) => {
      const t = initConvexTest(schema);
      const contentTypes = await t.action(testApi.persistMultiStep, { stream });
      expect(contentTypes.filter((type) => type === "tool-call")).toHaveLength(
        1,
      );
      expect(
        contentTypes.filter((type) => type === "tool-result"),
      ).toHaveLength(1);
      expect(contentTypes.filter((type) => type === "text")).toHaveLength(1);
    },
  );
  test("an empty response finalizes its pending assistant row", async () => {
    const t = initConvexTest(schema);
    const messages = await t.action(testApi.persistEmptyResponse, {});
    expect(messages.filter((message) => message.status === "pending")).toEqual(
      [],
    );
    expect(messages.filter((message) => message.role === "assistant")).toEqual([
      { role: "assistant", content: [], status: "success" },
    ]);
  });
  test("AI SDK v7 lifecycle, instructions, and raw metadata preserve Agent behavior", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.exerciseV7Boundary, {});
    expect(result).toEqual({
      boundaryOnStepEndCalls: 1,
      boundaryOnStepFinishCalls: 1,
      boundaryThrowingCallbackCalls: 1,
      hasStoredSystemMessage: true,
      hasRequestInstructions: true,
      rawRequestIncluded: true,
      rawResponseIncluded: true,
      assistantMessages: 3,
      pendingMessages: 0,
    });
  });
  test("AI SDK v7 runtime and tool contexts flow through Agent", async () => {
    const t = initConvexTest(schema);
    const result = await t.action(testApi.exerciseV7Contexts, {});
    expect(result).toEqual({
      observedToolContext: "tenant-ctx:hello",
      observedRuntimeContext: "request-ctx",
    });
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
          input: { test: "test" },
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
    message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
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

describe("Agent option variations and normal behavior", () => {
  test("Agent can be constructed with minimal options", () => {
    const a = new Agent(components.agent, {
      name: "minimal",
      languageModel: mockModel(),
    });
    expect(a).toBeInstanceOf(Agent);
  });

  test("Agent can be constructed with all options", () => {
    const a = new Agent(components.agent, {
      name: "full",
      languageModel: mockModel(),
      instructions: "Test instructions",
      contextOptions: { recentMessages: 5 },
      storageOptions: { saveMessages: "all" },
      stopWhen: isStepCount(2),
      callSettings: { maxRetries: 1 },
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
      createThread(ctx, components.agent, { userId: "2" }),
    );
    expect(threadId).toBeTypeOf("string");
  });

  test("continueThread returns thread object", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "3" }),
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
      createThread(ctx, components.agent, { userId: "4" }),
    );
    const { messageId } = await t.run(async (ctx) =>
      agent.saveMessage(ctx, {
        threadId,
        userId: "4",
        message: { role: "user", content: "Hello" },
      }),
    );
    expect(messageId).toBeTypeOf("string");

    const { messages } = await t.run(async (ctx) =>
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
    expect(messages[1]._id).toBeDefined();
  });
});

describe("Agent text/object generation", () => {
  test("generateText with custom context and storage options", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "5" }),
    );
    const result = await t.action(testApi.generateTextWithThread, {
      threadId,
      userId: "5",
      messages: [{ role: "user", content: "Test" }],
      contextOptions: { recentMessages: 1 },
      storageOptions: { saveMessages: "all" },
    });
    expect(result.text).toEqual(TEST_TEXT);
  });

  test("generateObject returns object", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "6" }),
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
    const result = await t.mutation(testApi.createThreadManually, {});
    expect(result.threadId).toBeTypeOf("string");
  });

  test("asTextAction and asObjectAction work via t.action", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "8" }),
    );
    const textResult = await t.action(testApi.generateTextAction, {
      userId: "8",
      threadId,
      messages: [{ role: "user", content: "Say hi" }],
    });
    expect(textResult.text).toEqual(TEST_TEXT);

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
      createThread(ctx, components.agent, { userId: "9" }),
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
    expect(result.messages.length).toBe(1);
    expect(result.messages[0]._id).toBeDefined();
  });
});

describe("Agent context and search options", () => {
  test("fetchContextMessages returns context messages", async () => {
    const t = initConvexTest(schema);
    const threadId = await t.run(async (ctx) =>
      createThread(ctx, components.agent, { userId: "10" }),
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
