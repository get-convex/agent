import { describe, expect, test, vi } from "vitest";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import { Agent, defineAgentModel, defineTool, type AgentModel } from "../../src/client/index.js";
import { components, initConvexTest } from "../setup/client.js";

const action = actionGeneric;

async function testAction<Result = any>(
  t: ReturnType<typeof initConvexTest>,
  actionFn: unknown,
  args: Record<string, unknown> = {},
): Promise<Result> {
  return (await t.action(
    actionFn as Parameters<ReturnType<typeof initConvexTest>["action"]>[0],
    args as never,
  )) as Result;
}

function userMessage(text: string, userId?: string) {
  return {
    author: { type: "user" as const, userId },
    content: [{ type: "text" as const, text }],
  };
}

function agentMessage(text: string, name = "raw-core-test") {
  return {
    author: { type: "agent" as const, name },
    content: [{ type: "text" as const, text }],
  };
}

const textModel: AgentModel = {
  async *execute() {
    yield { type: "text.delta", text: "hello" };
    yield { type: "text.delta", text: " world" };
  },
};

const rawAgent = new Agent(components.agent, {
  name: "raw-core-test",
  model: textModel,
});

const toolAgent = new Agent(components.agent, {
  name: "tool-core-test",
  model: {
    async *execute() {
      yield {
        type: "tool.call",
        toolCallId: "call-1",
        name: "echo",
        input: { text: "from tool" },
      };
      yield { type: "text.delta", text: "done" };
    },
  },
  tools: {
    echo: defineTool({
      async execute(input) {
        return input;
      },
    }),
  },
});

const approvalAgent = new Agent(components.agent, {
  name: "approval-core-test",
  model: {
    async *execute() {
      yield {
        type: "tool.call",
        toolCallId: "call-approval",
        name: "refund",
        input: { paymentId: "pay_123" },
      };
    },
  },
  tools: {
    refund: defineTool({
      needsApproval: true,
      async execute() {
        return { refunded: true };
      },
    }),
  },
});

const dataOutputAgent = new Agent(components.agent, {
  name: "data-output-test",
  model: defineAgentModel({
    async *execute() {
      yield { type: "data", name: "progress", value: { stage: "started" } };
      yield { type: "text.delta", text: "answer" };
      yield { type: "output", value: { ok: true } };
    },
  }),
});

const usageAgent = new Agent(components.agent, {
  name: "usage-test",
  model: defineAgentModel({
    async *execute() {
      yield {
        type: "usage",
        usage: {
          inputTokens: 3,
          outputTokens: 5,
          totalTokens: 8,
          tokenDetails: {
            input: { cachedTokens: 1 },
            output: { reasoningTokens: 2 },
          },
        },
      };
      yield { type: "text.delta", text: "usage recorded" };
    },
  }),
});

const messageUsageAgent = new Agent(components.agent, {
  name: "message-usage-test",
  model: defineAgentModel({
    async *execute() {
      yield {
        type: "message",
        message: {
          message: agentMessage("message usage", "message-usage-test"),
          usage: {
            inputTokens: 4,
            outputTokens: 6,
            totalTokens: 10,
          },
        },
      };
    },
  }),
});

const abortingModelAgent = new Agent(components.agent, {
  name: "aborting-model-test",
  model: defineAgentModel({
    async *execute(request) {
      if (request.signal?.aborted) {
        throw new Error("Provider request aborted");
      }
      yield { type: "text.delta", text: "should not persist" };
    },
  }),
});

const validatedOutputAgent = new Agent(components.agent, {
  name: "validated-output-test",
  output: v.object({ ok: v.boolean() }),
  model: defineAgentModel({
    async *execute() {
      yield { type: "output", value: { ok: true } };
      yield { type: "text.delta", text: "valid output" };
    },
  }),
});

const invalidOutputAgent = new Agent(components.agent, {
  name: "invalid-output-test",
  output: v.object({ ok: v.boolean() }),
  model: defineAgentModel({
    async *execute() {
      yield { type: "output", value: { ok: "no" } };
    },
  }),
});

const cancelingToolAgent = new Agent(components.agent, {
  name: "cancel-tool-test",
  model: defineAgentModel({
    async *execute() {
      yield {
        type: "tool.call",
        toolCallId: "call-cancel",
        name: "cancel",
        input: {},
      };
      yield { type: "text.delta", text: "late text" };
    },
  }),
  tools: {
    cancel: defineTool({
      async execute(_input, context) {
        await cancelingToolAgent.runs.cancel(context.ctx, {
          runId: context.runId,
          reason: context.signal ? "tool saw signal" : "tool canceled",
        });
        return { late: true };
      },
    }),
  },
});

export const sendRawRun = action({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.runMutation(components.agent.threads.createThread, {
      userId: "raw-user",
      title: "Raw core",
    });
    return await rawAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "raw-user",
      prompt: "Say hello",
      key: args.key,
    });
  },
});

export const readRunHttpStream = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "http-user",
      title: "HTTP stream",
    });
    const run = await rawAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "http-user",
      prompt: "stream",
    });
    const response = await rawAgent.http(
      ctx,
      new Request(`https://agent.test/run?runId=${run.runId}`),
      { runId: run.runId },
    );
    return {
      status: response.status,
      streamId: response.headers.get("X-Stream-Id"),
      body: await response.text(),
    };
  },
});

export const readDataOutputEvents = action({
  args: {},
  handler: async (ctx) => {
    const thread = await dataOutputAgent.threads.create(ctx, {
      userId: "event-user",
      title: "Events",
    });
    const run = await dataOutputAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "event-user",
      prompt: "emit events",
    });
    const all = await dataOutputAgent.events.read(ctx, {
      runId: run.runId,
      numItems: 10,
    });
    const replay = await dataOutputAgent.events.read(ctx, {
      runId: run.runId,
      startIndex: 1,
      numItems: 10,
    });
    return { run, all, replay };
  },
});

export const executeUsageRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await usageAgent.threads.create(ctx, {
      userId: "usage-user",
      title: "Usage",
    });
    return await usageAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "usage-user",
      prompt: "usage",
    });
  },
});

export const executeMessageUsageRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await messageUsageAgent.threads.create(ctx, {
      userId: "message-usage-user",
      title: "Message usage",
    });
    return await messageUsageAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "message-usage-user",
      prompt: "usage",
    });
  },
});

export const executeAbortedSignalRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await abortingModelAgent.threads.create(ctx, {
      userId: "aborted-user",
      title: "Aborted",
    });
    const controller = new AbortController();
    controller.abort();
    const run = await abortingModelAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "aborted-user",
      prompt: "abort",
      signal: controller.signal,
    });
    const events = await abortingModelAgent.events.read(ctx, {
      runId: run.runId,
      numItems: 10,
    });
    return { run, events };
  },
});

export const executeValidatedOutputRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await validatedOutputAgent.threads.create(ctx, {
      userId: "output-user",
      title: "Output",
    });
    return await validatedOutputAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "output-user",
      prompt: "output",
    });
  },
});

export const executeInvalidOutputRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await invalidOutputAgent.threads.create(ctx, {
      userId: "invalid-output-user",
      title: "Invalid output",
    });
    return await invalidOutputAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "invalid-output-user",
      prompt: "output",
    });
  },
});

export const readWaitingApprovalEvents = action({
  args: {},
  handler: async (ctx) => {
    const thread = await approvalAgent.threads.create(ctx, {
      userId: "waiting-event-user",
      title: "Waiting event status",
    });
    const run = await approvalAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "waiting-event-user",
      prompt: "refund",
    });
    const events = await approvalAgent.events.read(ctx, {
      runId: run.runId,
      numItems: 10,
    });
    return { run, events };
  },
});

export const readBatchedRunEvents = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "batch-event-user",
      title: "Batched event reads",
    });
    const first = await rawAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "batch-event-user",
      prompt: "first",
    });
    const second = await dataOutputAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "batch-event-user",
      prompt: "second",
    });
    return await rawAgent.events.readBatch(ctx, {
      reads: [
        {
          runId: first.runId,
          streamArgs: { cursor: null, numItems: 10 },
        },
        {
          runId: second.runId,
          streamArgs: { cursor: null, numItems: 10 },
        },
      ],
    });
  },
});

export const readRunEventsWithCursorAndStartIndex = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "event-conflict-user",
      title: "Event cursor conflict",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "event-conflict-user",
      prompt: "conflict",
    });
    return await rawAgent.events.read(ctx, {
      runId: run.runId,
      cursor: null,
      startIndex: 0,
      numItems: 1,
    });
  },
});

export const startSameKeyTwice = action({
  args: {},
  handler: async (ctx) => {
    const thread = await ctx.runMutation(components.agent.threads.createThread, {
      userId: "key-user",
      title: "Key reuse",
    });
    const first = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "key-user",
      prompt: "First",
      key: "client-message:1",
    });
    const second = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "key-user",
      prompt: "First",
      key: "client-message:1",
    });
    return { first, second };
  },
});

export const startWithClientKey = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "client-key-user",
      title: "Client key",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "client-key-user",
      key: "client-message:start",
      message: {
        clientKey: "client-message:start",
        message: userMessage("hello", "client-key-user"),
        text: "hello",
      },
    });
    const listed = await rawAgent.messages.list(ctx, {
      threadId: thread._id,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    return { run, listed };
  },
});

export const startConflictingKey = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "key-conflict-user",
      title: "Key conflict",
    });
    await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "key-conflict-user",
      prompt: "First",
      key: "client-message:conflict",
    });
    return await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "key-conflict-user",
      prompt: "Second",
      key: "client-message:conflict",
    });
  },
});

export const saveAndListMessages = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "message-user",
      title: "Messages",
    });
    const [first] = await rawAgent.messages.save(ctx, {
      threadId: thread._id,
      userId: "message-user",
      messages: [
        {
          clientKey: "client-message:save",
          message: userMessage("hello", "message-user"),
          text: "hello",
        },
      ],
    });
    const [second] = await rawAgent.messages.save(ctx, {
      threadId: thread._id,
      userId: "message-user",
      promptMessageId: first._id,
      messages: [
        {
          message: agentMessage("hi back"),
          usage: {
            inputTokens: 1,
            outputTokens: 2,
            totalTokens: 3,
          },
        },
      ],
    });
    const listed = await rawAgent.messages.list(ctx, {
      threadId: thread._id,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    return { thread, first, second, listed };
  },
});

export const executeToolRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await toolAgent.threads.create(ctx, {
      userId: "tool-user",
      title: "Tools",
    });
    return await toolAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "tool-user",
      prompt: "use the tool",
    });
  },
});

export const executeApprovalRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await approvalAgent.threads.create(ctx, {
      userId: "approval-user",
      title: "Approvals",
    });
    const run = await approvalAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "approval-user",
      prompt: "refund",
    });
    const approved = await approvalAgent.tool.approve(ctx, {
      runId: run.runId,
      toolCallId: "call-approval",
    });
    const resumed = await approvalAgent.runs.execute(ctx, {
      runId: run.runId,
    });
    const toolCalls = await approvalAgent.tool.list(ctx, {
      runId: run.runId,
    });
    return { run, approved, resumed, toolCalls };
  },
});

export const listRunsByStatus = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "list-user",
      title: "Runs",
    });
    await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "list-user",
      prompt: "pending",
    });
    await rawAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "list-user",
      prompt: "success",
    });
    return await rawAgent.runs.list(ctx, {
      threadId: thread._id,
      statuses: ["pending"],
      paginationOpts: { cursor: null, numItems: 10 },
    });
  },
});

export const claimRunTwice = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "claim-user",
      title: "Claim",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "claim-user",
      prompt: "claim",
    });
    const first = await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: run.runId,
      executionId: "first",
    });
    const second = await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: run.runId,
      executionId: "second",
    });
    return { first, second };
  },
});

export const startAndClaimRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "expired-claim-user",
      title: "Expired claim",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "expired-claim-user",
      prompt: "claim",
    });
    const claim = await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: run.runId,
      executionId: "first",
    });
    return { run, claim };
  },
});

export const claimExistingRun = action({
  args: { runId: v.string(), executionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: args.runId,
      executionId: args.executionId,
    });
  },
});

export const staleExecutionCannotAppend = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "stale-execution-user",
      title: "Stale execution",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "stale-execution-user",
      prompt: "claim",
    });
    await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: run.runId,
      executionId: "first",
    });
    return await ctx.runMutation(components.agent.runs.appendEvents, {
      runId: run.runId,
      executionId: "second",
      startSequence: 0,
      events: [{ type: "text.delta", text: "stale" }],
    });
  },
});

export const cancelThenFail = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "cancel-user",
      title: "Cancel",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "cancel-user",
      prompt: "cancel",
    });
    await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: run.runId,
      executionId: "execution",
    });
    const canceled = await rawAgent.runs.cancel(ctx, {
      runId: run.runId,
      reason: "stop",
    });
    const failed = await ctx.runMutation(components.agent.runs.fail, {
      runId: run.runId,
      executionId: "execution",
      error: { code: "late", message: "late failure" },
    });
    return { canceled, failed };
  },
});

export const appendAfterCancel = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "append-cancel-user",
      title: "Append after cancel",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "append-cancel-user",
      prompt: "cancel",
    });
    const claim = await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: run.runId,
      executionId: "execution",
    });
    const canceled = await rawAgent.runs.cancel(ctx, {
      runId: run.runId,
      reason: "stop",
    });
    const append = await ctx.runMutation(components.agent.runs.appendEvents, {
      runId: run.runId,
      executionId: "execution",
      startSequence: claim.nextEventSequence,
      events: [{ type: "text.delta", text: "late" }],
    });
    const events = await rawAgent.events.read(ctx, {
      runId: run.runId,
      numItems: 10,
    });
    return { canceled, append, events };
  },
});

export const cancelWaitingRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await approvalAgent.threads.create(ctx, {
      userId: "cancel-waiting-user",
      title: "Cancel waiting",
    });
    const waiting = await approvalAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "cancel-waiting-user",
      prompt: "refund",
    });
    const canceled = await approvalAgent.runs.cancel(ctx, {
      runId: waiting.runId,
      reason: "stop waiting",
    });
    return { waiting, canceled };
  },
});

export const executeCancelingToolRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await cancelingToolAgent.threads.create(ctx, {
      userId: "cancel-tool-user",
      title: "Cancel tool",
    });
    const controller = new AbortController();
    const run = await cancelingToolAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "cancel-tool-user",
      prompt: "tool",
      signal: controller.signal,
    });
    const events = await cancelingToolAgent.events.read(ctx, {
      runId: run.runId,
      numItems: 10,
    });
    const toolCalls = await cancelingToolAgent.tool.list(ctx, {
      runId: run.runId,
    });
    return { run, events, toolCalls };
  },
});

export const startAfterPendingMessage = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "order-user",
      title: "Order",
    });
    await rawAgent.messages.save(ctx, {
      threadId: thread._id,
      userId: "order-user",
      messages: [userMessage("first", "order-user")],
    });
    await rawAgent.messages.save(ctx, {
      threadId: thread._id,
      userId: "order-user",
      messages: [
        {
          message: agentMessage("pending"),
          status: "pending",
        },
      ],
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "order-user",
      prompt: "after pending",
    });
    const listed = await rawAgent.messages.list(ctx, {
      threadId: thread._id,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    return { run, listed };
  },
});

export const executeWithRecentContext = action({
  args: {},
  handler: async (ctx) => {
    const agent = new Agent(components.agent, {
      name: "recent-context-test",
      model: {
        async *execute(request) {
          yield {
            type: "message",
            message: {
              message: {
                author: { type: "agent", name: "recent-context-test" },
                content: [
                  {
                    type: "text",
                    text: request.messages
                      .map((message) => message.text)
                      .join("|"),
                  },
                ],
              },
            },
          };
        },
      },
    });
    const thread = await agent.threads.create(ctx, {
      userId: "recent-user",
      title: "Recent",
    });
    for (let i = 0; i < 5; i++) {
      await agent.messages.save(ctx, {
        threadId: thread._id,
        userId: "recent-user",
        messages: [userMessage(`m${i}`, "recent-user")],
      });
    }
    const run = await agent.runs.start(ctx, {
      threadId: thread._id,
      userId: "recent-user",
    });
    await agent.runs.execute(ctx, {
      runId: run.runId,
      recentMessages: 2,
    });
    return await agent.messages.list(ctx, {
      threadId: thread._id,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 10 },
    });
  },
});

export const executeWithContextLoaders = action({
  args: {},
  handler: async (ctx) => {
    const agent = new Agent(components.agent, {
      name: "context-loader-test",
      model: {
        async *execute(request) {
          yield {
            type: "message",
            message: {
              message: {
                author: { type: "agent", name: "context-loader-test" },
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      messages: request.messages.map((message) => message.text),
                      context: request.context.map((block) => ({
                        name: block.name,
                        text: block.text,
                      })),
                    }),
                  },
                ],
              },
            },
          };
        },
      },
    });
    const thread = await agent.threads.create(ctx, {
      userId: "context-user",
      title: "Context loaders",
    });
    await agent.messages.save(ctx, {
      threadId: thread._id,
      userId: "context-user",
      messages: [userMessage("m0", "context-user")],
    });
    await agent.messages.save(ctx, {
      threadId: thread._id,
      userId: "context-user",
      messages: [userMessage("m1", "context-user")],
    });
    const run = await agent.runs.start(ctx, {
      threadId: thread._id,
      userId: "context-user",
      prompt: "prompt",
    });
    await agent.runs.execute(ctx, {
      runId: run.runId,
      recentMessages: 2,
      context: [
        async (_ctx, { promptMessage, recentMessages }) => [
          {
            type: "text",
            name: "first",
            text: `${promptMessage?.text}:${recentMessages.length}`,
          },
        ],
        async () => [{ type: "text", name: "second", text: "later" }],
      ],
    });
    return await agent.messages.list(ctx, {
      threadId: thread._id,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 10 },
    });
  },
});

export const executeWithFailingContextLoader = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "context-fail-user",
      title: "Context failure",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "context-fail-user",
      prompt: "fail context",
    });
    return await rawAgent.runs.execute(ctx, {
      runId: run.runId,
      context: async () => {
        throw new Error("context unavailable");
      },
    });
  },
});

export const approvalBeforeWaiting = action({
  args: {},
  handler: async (ctx) => {
    const thread = await approvalAgent.threads.create(ctx, {
      userId: "approval-race-user",
      title: "Approval race",
    });
    const run = await approvalAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "approval-race-user",
    });
    const claim = await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: run.runId,
      executionId: "race",
    });
    await ctx.runMutation(components.agent.runs.appendEvents, {
      runId: run.runId,
      executionId: "race",
      startSequence: claim.nextEventSequence,
      events: [
        {
          type: "approval.request",
          approvalId: "approval:race",
          toolCallId: "race",
          name: "refund",
          input: {},
        },
      ],
    });
    return await approvalAgent.tool.approve(ctx, {
      runId: run.runId,
      toolCallId: "race",
    });
  },
});

export const executeWaitingRunBeforeApproval = action({
  args: {},
  handler: async (ctx) => {
    const thread = await approvalAgent.threads.create(ctx, {
      userId: "approval-waiting-user",
      title: "Approval waiting",
    });
    const run = await approvalAgent.runs.send(ctx, {
      threadId: thread._id,
      userId: "approval-waiting-user",
      prompt: "refund",
    });
    const attempted = await approvalAgent.runs.execute(ctx, {
      runId: run.runId,
    });
    const toolCalls = await approvalAgent.tool.list(ctx, {
      runId: run.runId,
    });
    return { run, attempted, toolCalls };
  },
});

export const listToolCallAfterLongRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "long-run-user",
      title: "Long run",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "long-run-user",
    });
    const claim = await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: run.runId,
      executionId: "long",
    });
    let nextEventSequence = claim.nextEventSequence;
    const receipt = await ctx.runMutation(components.agent.runs.appendEvents, {
      runId: run.runId,
      executionId: "long",
      startSequence: nextEventSequence,
      events: Array.from({ length: 200 }, (_, i) => ({
        type: "text.delta" as const,
        text: `${i}`,
      })),
    });
    nextEventSequence = receipt.nextEventSequence;
    await ctx.runMutation(components.agent.runs.requestApproval, {
      runId: run.runId,
      executionId: "long",
      startSequence: nextEventSequence,
      events: [
        {
          type: "tool.call",
          toolCallId: "late-tool",
          name: "echo",
          input: { ok: true },
        },
        {
          type: "approval.request",
          approvalId: "approval:late-tool",
          toolCallId: "late-tool",
          name: "echo",
          input: { ok: true },
        },
      ],
      toolCallIds: ["late-tool"],
    });
    return await rawAgent.tool.list(ctx, { runId: run.runId });
  },
});

export const approveToolCallAfterLongRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "long-approval-user",
      title: "Long approval",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "long-approval-user",
    });
    const claim = await ctx.runMutation(components.agent.runs.beginExecution, {
      runId: run.runId,
      executionId: "long-approval",
    });
    const receipt = await ctx.runMutation(components.agent.runs.appendEvents, {
      runId: run.runId,
      executionId: "long-approval",
      startSequence: claim.nextEventSequence,
      events: Array.from({ length: 200 }, (_, i) => ({
        type: "reasoning.delta" as const,
        text: `${i}`,
      })),
    });
    await ctx.runMutation(components.agent.runs.requestApproval, {
      runId: run.runId,
      executionId: "long-approval",
      startSequence: receipt.nextEventSequence,
      events: [
        {
          type: "tool.call",
          toolCallId: "late-approval-tool",
          name: "echo",
          input: { ok: true },
        },
        {
          type: "approval.request",
          approvalId: "approval:late-approval-tool",
          toolCallId: "late-approval-tool",
          name: "echo",
          input: { ok: true },
        },
      ],
      toolCallIds: ["late-approval-tool"],
    });
    const approved = await rawAgent.tool.approve(ctx, {
      runId: run.runId,
      toolCallId: "late-approval-tool",
    });
    const toolCalls = await rawAgent.tool.list(ctx, { runId: run.runId });
    return { approved, toolCalls };
  },
});

export const deleteThreadWithRun = action({
  args: {},
  handler: async (ctx) => {
    const thread = await rawAgent.threads.create(ctx, {
      userId: "delete-run-user",
      title: "Delete run",
    });
    const run = await rawAgent.runs.start(ctx, {
      threadId: thread._id,
      userId: "delete-run-user",
      prompt: "delete me",
    });
    await ctx.runAction(components.agent.threads.deleteAllForThreadIdSync, {
      threadId: thread._id,
    });
    const runs = await rawAgent.runs.list(ctx, {
      threadId: thread._id,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const deletedThread = await rawAgent.threads.get(ctx, { threadId: thread._id });
    const deletedRun = await rawAgent.runs.get(ctx, { runId: run.runId });
    return { runs, deletedThread, deletedRun };
  },
});

describe("core Agent runs", () => {
  test("send executes a model-agnostic run and materializes a message with an implicit stream", async () => {
    const t = initConvexTest();

    const run = await testAction(t, sendRawRun);

    expect(run.status).toBe("success");
    expect(run.streamId).toBeTruthy();
    expect(run.messageId).toBeTruthy();
    expect(run.resultMessageIds).toHaveLength(1);
  });

  test("http serves a finished run stream", async () => {
    const t = initConvexTest();

    const response = await testAction(t, readRunHttpStream);

    expect(response.status).toBe(200);
    expect(response.streamId).toBeTruthy();
    expect(response.body).toContain("event: event");
    expect(response.body).toContain("event: done");
  });

  test("readRunEvents returns Agent-native data and output events", async () => {
    const t = initConvexTest();

    const { run, all, replay } = await testAction(t, readDataOutputEvents);

    expect(run.status).toBe("success");
    expect(run.output).toEqual({ ok: true });
    expect(all.status).toBe("success");
	    expect(all.streamStatus).toBe("success");
	    expect(all.page.map((item: { event: { type: string } }) => item.event.type))
	      .toEqual(["data", "text.delta", "output", "done"]);
    expect(all.page[0].event).toMatchObject({
      type: "data",
      name: "progress",
      value: { stage: "started" },
    });
    expect(all.page[2].event).toMatchObject({
      type: "output",
      value: { ok: true },
    });
	    expect(replay.page.map((item: { index: number }) => item.index)).toEqual([
	      1, 2, 3,
	    ]);
	  });

  test("run usage persists from usage events", async () => {
    const t = initConvexTest();

    const run = await testAction(t, executeUsageRun);

    expect(run.status).toBe("success");
    expect(run.usage).toEqual({
      inputTokens: 3,
      outputTokens: 5,
      totalTokens: 8,
      tokenDetails: {
        input: { cachedTokens: 1 },
        output: { reasoningTokens: 2 },
      },
    });
  });

  test("run usage persists from message events", async () => {
    const t = initConvexTest();

    const run = await testAction(t, executeMessageUsageRun);

    expect(run.usage).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
    });
  });

  test("validated structured output persists on the run", async () => {
    const t = initConvexTest();

    const run = await testAction(t, executeValidatedOutputRun);

    expect(run.status).toBe("success");
    expect(run.output).toEqual({ ok: true });
  });

  test("invalid structured output fails the run", async () => {
    const t = initConvexTest();

    const run = await testAction(t, executeInvalidOutputRun);

    expect(run.status).toBe("failed");
    expect(run.output).toBeUndefined();
    expect(run.error?.message).toBeTruthy();
  });

	  test("readRunEvents exposes Agent waiting status separately from Stream status", async () => {
	    const t = initConvexTest();

	    const { run, events } = await testAction(t, readWaitingApprovalEvents);

	    expect(run.status).toBe("waiting");
	    expect(events.status).toBe("waiting");
	    expect(events.streamStatus).toBe("running");
	    expect(events.page.map((item: { event: { type: string } }) => item.event.type))
	      .toEqual(["tool.call", "approval.request"]);
	  });

	  test("readRunEvents rejects cursor and startIndex together", async () => {
	    const t = initConvexTest();

	    await expect(
	      testAction(t, readRunEventsWithCursorAndStartIndex),
	    ).rejects.toThrow(/cursor and startIndex are mutually exclusive/);
	  });

  test("start reuses a durable run by key", async () => {
    const t = initConvexTest();

    const { first, second } = await testAction(t, startSameKeyTwice);

    expect(second.runId).toBe(first.runId);
    expect(second.streamId).toBe(first.streamId);
    expect(second.messageId).toBe(first.messageId);
  });

  test("start persists client message correlation", async () => {
    const t = initConvexTest();

    const { run, listed } = await testAction(t, startWithClientKey);

    expect(run.messageId).toBeTruthy();
    expect(listed.page).toHaveLength(1);
    expect(listed.page[0].clientKey).toBe("client-message:start");
  });

  test("start rejects conflicting input for the same scoped key", async () => {
    const t = initConvexTest();

    await expect(testAction(t, startConflictingKey)).rejects.toThrow(
      /different input/,
    );
  });

  test("restores Convex-native thread and message APIs", async () => {
    const t = initConvexTest();

    const { thread, first, second, listed } = await testAction(t, saveAndListMessages);

    expect(thread._id).toBeTruthy();
    expect(first.message?.author.type).toBe("user");
    expect(first.clientKey).toBe("client-message:save");
    expect(listed.page[0].clientKey).toBe("client-message:save");
    expect(second.usage?.totalTokens).toBe(3);
    expect(listed.page.map((message: { text?: string }) => message.text)).toEqual([
      "hello",
      "hi back",
    ]);
  });

  test("executes Agent-native tools and materializes tool events", async () => {
    const t = initConvexTest();

    const run = await testAction(t, executeToolRun);

    expect(run.status).toBe("success");
    expect(run.resultMessageIds).toHaveLength(1);
  });

  test("persists approval waiting state and resumes from projected tool state", async () => {
    const t = initConvexTest();

    const { run, approved, resumed, toolCalls } = await testAction(t, executeApprovalRun);

    expect(run.status).toBe("waiting");
    expect(run.waiting?.toolCallIds).toEqual(["call-approval"]);
    expect(approved.status).toBe("pending");
    expect(approved.waiting).toBeUndefined();
    expect(resumed.status).toBe("success");
    expect(toolCalls).toMatchObject([
      {
        toolCallId: "call-approval",
        status: "success",
        approved: true,
        output: { refunded: true },
      },
    ]);
  });

  test("listRuns paginates and filters by run status", async () => {
    const t = initConvexTest();

    const page = await testAction(t, listRunsByStatus);

    expect(page.page).toHaveLength(1);
    expect(page.page[0].status).toBe("pending");
  });

  test("readRunEventsBatch returns run-keyed event pages", async () => {
    const t = initConvexTest();

    const reads = await testAction(t, readBatchedRunEvents);

    expect(reads).toHaveLength(2);
    expect(reads[0].runId).toBeTruthy();
    expect(reads[0].page.map((item: { event: { type: string } }) => item.event.type))
      .toEqual(["text.delta", "text.delta", "done"]);
    expect(reads[1].page.map((item: { event: { type: string } }) => item.event.type))
      .toEqual(["data", "text.delta", "output", "done"]);
    expect(reads[0].streamId).toBeUndefined();
  });

  test("only one execution can claim a run", async () => {
    const t = initConvexTest();

    const { first, second } = await testAction(t, claimRunTwice);

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
  });

  test("expired execution leases fail instead of reclaiming the run", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const t = initConvexTest();

      const { run, claim } = await testAction(t, startAndClaimRun);
      expect(claim.claimed).toBe(true);

      vi.setSystemTime(new Date("2026-01-01T00:06:00.000Z"));
      const second = await testAction(t, claimExistingRun, {
        runId: run.runId,
        executionId: "second",
      });

      expect(second.claimed).toBe(false);
      expect(second.run.status).toBe("failed");
      expect(second.run.error).toMatchObject({
        code: "executionLeaseExpired",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("unclaimed executions cannot append", async () => {
    const t = initConvexTest();

    await expect(testAction(t, staleExecutionCannotAppend)).rejects.toThrow(
      /not claimed by this execution/,
    );
  });

  test("late failure after cancel returns the canceled run", async () => {
    const t = initConvexTest();

    const { canceled, failed } = await testAction(t, cancelThenFail);

    expect(canceled.status).toBe("canceled");
    expect(failed.status).toBe("canceled");
  });

  test("late event append after cancel does not persist events", async () => {
    const t = initConvexTest();

    const { canceled, append, events } = await testAction(t, appendAfterCancel);

    expect(canceled.status).toBe("canceled");
    expect(append).toMatchObject({
      stopped: true,
      run: { status: "canceled" },
    });
    expect(events.page).toHaveLength(0);
    expect(events.status).toBe("canceled");
  });

  test("aborted model errors cancel instead of failing the run", async () => {
    const t = initConvexTest();

    const { run, events } = await testAction(t, executeAbortedSignalRun);

    expect(run.status).toBe("canceled");
    expect(run.error).toEqual({
      code: "canceled",
      message: "Execution aborted.",
    });
    expect(events.page).toHaveLength(0);
    expect(events.status).toBe("canceled");
  });

  test("cancel clears waiting metadata", async () => {
    const t = initConvexTest();

    const { waiting, canceled } = await testAction(t, cancelWaitingRun);

    expect(waiting.status).toBe("waiting");
    expect(waiting.waiting).toBeTruthy();
    expect(canceled.status).toBe("canceled");
    expect(canceled.waiting).toBeUndefined();
  });

  test("cancel during tool execution prevents late tool results and messages", async () => {
    const t = initConvexTest();

    const { run, events, toolCalls } = await testAction(t, executeCancelingToolRun);

    expect(run.status).toBe("canceled");
    expect(run.resultMessageIds).toBeUndefined();
    expect(events.page.map((item: { event: { type: string } }) => item.event.type))
      .toEqual(["tool.call"]);
    expect(toolCalls).toMatchObject([
      {
        toolCallId: "call-cancel",
        status: "canceled",
      },
    ]);
  });

  test("start assigns prompt order after pending messages", async () => {
    const t = initConvexTest();

    const { run, listed } = await testAction(t, startAfterPendingMessage);

    expect(run.messageId).toBeTruthy();
    expect(listed.page.map((message: { text?: string }) => message.text)).toEqual([
      "first",
      "pending",
      "after pending",
    ]);
  });

  test("recent context uses the newest messages in chronological order", async () => {
    const t = initConvexTest();

    const listed = await testAction(t, executeWithRecentContext);

    expect(listed.page.at(-1)?.text).toBe("m3|m4");
  });

  test("execute passes app context loader blocks to the model in order", async () => {
    const t = initConvexTest();

    const listed = await testAction(t, executeWithContextLoaders);
    const payload = JSON.parse(listed.page.at(-1)?.text ?? "{}");

    expect(payload.messages).toEqual(["m1", "prompt"]);
    expect(payload.context).toEqual([
      { name: "first", text: "prompt:2" },
      { name: "second", text: "later" },
    ]);
  });

  test("context loader errors fail the claimed run", async () => {
    const t = initConvexTest();

    const run = await testAction(t, executeWithFailingContextLoader);

    expect(run.status).toBe("failed");
    expect(run.error).toMatchObject({
      code: "Error",
      message: "context unavailable",
    });
  });

  test("approval cannot resolve before the run is waiting", async () => {
    const t = initConvexTest();

    await expect(testAction(t, approvalBeforeWaiting)).rejects.toThrow(
      /not waiting for approval/,
    );
  });

  test("waiting runs do not execute again before approval resolves", async () => {
    const t = initConvexTest();

    const { run, attempted, toolCalls } = await testAction(t, executeWaitingRunBeforeApproval);

    expect(run.status).toBe("waiting");
    expect(attempted.status).toBe("waiting");
    expect(toolCalls).toMatchObject([{ status: "waiting" }]);
  });

  test("tool-call listing uses bounded projection without replaying history", async () => {
    const t = initConvexTest();

    const toolCalls = await testAction(t, listToolCallAfterLongRun);

    expect(toolCalls).toMatchObject([
      {
        toolCallId: "late-tool",
        status: "waiting",
      },
    ]);
  });

  test("approval resolution uses bounded tool-call state after long streams", async () => {
    const t = initConvexTest();

    const { approved, toolCalls } = await testAction(t, approveToolCallAfterLongRun);

    expect(approved.status).toBe("pending");
    expect(toolCalls).toMatchObject([
      {
        toolCallId: "late-approval-tool",
        status: "pending",
        approved: true,
      },
    ]);
  });

  test("thread deletion removes runs and run streams", async () => {
    const t = initConvexTest();

    const { runs, deletedThread, deletedRun } = await testAction(t, deleteThreadWithRun);

    expect(runs.page).toHaveLength(0);
    expect(deletedThread).toBeNull();
    expect(deletedRun).toBeNull();
  });
});
