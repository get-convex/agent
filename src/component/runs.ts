import {
  paginationOptsValidator,
  paginationResultValidator,
  type WithoutSystemFields,
} from "convex/server";
import { ConvexError, v, type Value } from "convex/values";
import { streamId } from "@convex-dev/stream";
import { assert } from "convex-helpers";
import { paginator } from "convex-helpers/server/pagination";
import { mergedStream, stream as dbStream } from "convex-helpers/server/stream";
import {
  vAgentToolCall,
  vAgentError,
  vAgentRunEvent,
  vAgentStatus,
  vAgentMessageInputInternal,
  vPublicRun,
  type AgentRunEvent,
  type AgentMessageInputInternal,
} from "../validators.js";
import { defineAgentRunEventStream } from "../runStreams.js";
import { components } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server.js";
import { schema } from "./schema.js";
import {
  addMessagesHandler,
  getMaxMessage as getMaxThreadMessage,
} from "./messages.js";
import { extractText, isTool, stableHash } from "../shared.js";

const runEventStream = defineAgentRunEventStream(components.stream);
const executionLeaseMs = 5 * 60 * 1000;
const vStreamStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("success"),
  v.literal("failed"),
  v.literal("canceled"),
);
const vStoppedRunWrite = v.object({
  stopped: v.literal(true),
  run: vPublicRun,
  nextEventSequence: v.number(),
});
const vAppendedRunEvents = v.object({
  stopped: v.literal(false),
  firstIndex: v.number(),
  lastIndex: v.number(),
  eventCount: v.number(),
  nextEventSequence: v.number(),
});
const vReadEventsResult = v.object({
  page: v.array(
    v.object({
      index: v.number(),
      sequence: v.number(),
      event: vAgentRunEvent,
    }),
  ),
  continueCursor: v.string(),
  nextIndex: v.number(),
  isDone: v.boolean(),
  upToDate: v.boolean(),
  status: vAgentStatus,
  streamStatus: vStreamStatus,
  error: v.optional(vAgentError),
});
const vReadEventsBatchResult = v.array(
  v.object({ runId: v.string(), ...vReadEventsResult.fields }),
);

function publicRun(run: Doc<"runs">) {
  assert(run.streamId, `Run ${run._id} does not have a stream`);
  return {
    runId: run._id,
    threadId: run.threadId,
    userId: run.userId,
    agentName: run.agentName,
    messageId: run.messageId,
    resultMessageIds: run.resultMessageIds,
    streamId: run.streamId,
    workflowId: run.workflowId,
    key: run.key,
    status: run.status,
    waiting: run.waiting,
    error: run.error,
    usage: run.usage,
    output: run.output,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

async function patchRunAndProject(
  ctx: MutationCtx,
  id: Id<"runs">,
  patch: Partial<WithoutSystemFields<Doc<"runs">>>,
): Promise<PublicRun> {
  await ctx.db.patch("runs", id, patch);
  const updated = await ctx.db.get("runs", id);
  assert(updated, `Run not found: ${id}`);
  return publicRun(updated);
}

const terminalStatuses = new Set(["success", "failed", "canceled"]);

function isTerminal(status: Doc<"runs">["status"]) {
  return terminalStatuses.has(status);
}

function requestHash(args: {
  userId?: string;
  prompt?: string;
  message?: unknown;
  agentName: string;
  threadId: Id<"threads">;
}) {
  return stableHash({
    userId: args.userId ?? null,
    prompt: args.prompt ?? null,
    message: args.message === undefined ? null : (args.message as Value),
    agentName: args.agentName,
    threadId: args.threadId,
  });
}

async function ensureRunStream(
  ctx: MutationCtx,
  run: Doc<"runs">,
): Promise<Doc<"runs">> {
  if (run.streamId) {
    return run;
  }
  const streamIdValue = await runEventStream.getOrCreate(ctx, {
    key: `agent-run:v1:${run._id}`,
    metadata: {
      runId: run._id,
      threadId: run.threadId,
      userId: run.userId,
      agentName: run.agentName,
    },
  });
  await ctx.db.patch("runs", run._id, {
    streamId: streamIdValue,
    updatedAt: Date.now(),
  });
  const updated = await ctx.db.get("runs", run._id);
  assert(updated, `Run not found after stream creation: ${run._id}`);
  return updated;
}

function publicToolCall(toolCall: Doc<"runToolCalls">) {
  return {
    toolCallId: toolCall.toolCallId,
    runId: toolCall.runId,
    name: toolCall.name,
    input: toolCall.input,
    status: toolCall.status,
    approvalId: toolCall.approvalId,
    approved: toolCall.approved,
    reason: toolCall.reason,
    output: toolCall.output,
    error: toolCall.error,
    requestedAt: toolCall.requestedAt,
    resolvedAt: toolCall.resolvedAt,
  };
}

async function getRunToolCall(
  ctx: MutationCtx,
  runId: Id<"runs">,
  toolCallId: string,
) {
  return await ctx.db
    .query("runToolCalls")
    .withIndex("runId_toolCallId", (q) =>
      q.eq("runId", runId).eq("toolCallId", toolCallId),
    )
    .unique();
}

async function projectToolCallEvent(
  ctx: MutationCtx,
  run: Doc<"runs">,
  event: Extract<AgentRunEvent, { type: "tool.call" }>,
  existing: Doc<"runToolCalls"> | null,
  eventIndex: number,
  now: number,
) {
  if (existing) {
    await ctx.db.patch("runToolCalls", existing._id, {
      name: event.name,
      input: event.input,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("runToolCalls", {
    runId: run._id,
    toolCallId: event.toolCallId,
    name: event.name,
    input: event.input,
    status: "pending",
    requestedAt: eventIndex,
    updatedAt: now,
  });
}

async function projectApprovalRequestEvent(
  ctx: MutationCtx,
  run: Doc<"runs">,
  event: Extract<AgentRunEvent, { type: "approval.request" }>,
  existing: Doc<"runToolCalls"> | null,
  eventIndex: number,
  now: number,
) {
  if (existing) {
    await ctx.db.patch("runToolCalls", existing._id, {
      name: event.name,
      input: event.input,
      status: "waiting",
      approvalId: event.approvalId,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("runToolCalls", {
    runId: run._id,
    toolCallId: event.toolCallId,
    name: event.name,
    input: event.input,
    status: "waiting",
    approvalId: event.approvalId,
    requestedAt: eventIndex,
    updatedAt: now,
  });
}

async function projectApprovalResponseEvent(
  ctx: MutationCtx,
  event: Extract<AgentRunEvent, { type: "approval.response" }>,
  existing: Doc<"runToolCalls"> | null,
  eventIndex: number,
  now: number,
) {
  assert(
    existing,
    `Tool call ${event.toolCallId} has no projection for approval response`,
  );
  await ctx.db.patch("runToolCalls", existing._id, {
    status: event.approved ? "pending" : "canceled",
    approvalId: event.approvalId,
    approved: event.approved,
    reason: event.reason,
    resolvedAt: eventIndex,
    updatedAt: now,
  });
}

async function projectToolResultEvent(
  ctx: MutationCtx,
  run: Doc<"runs">,
  event: Extract<AgentRunEvent, { type: "tool.result" }>,
  existing: Doc<"runToolCalls"> | null,
  eventIndex: number,
  now: number,
) {
  if (existing) {
    await ctx.db.patch("runToolCalls", existing._id, {
      name: event.name ?? existing.name,
      status: event.error ? "failed" : "success",
      output: event.output,
      error: event.error,
      resolvedAt: eventIndex,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("runToolCalls", {
    runId: run._id,
    toolCallId: event.toolCallId,
    name: event.name ?? "unknown",
    input: null,
    status: event.error ? "failed" : "success",
    output: event.output,
    error: event.error,
    requestedAt: eventIndex,
    resolvedAt: eventIndex,
    updatedAt: now,
  });
}

async function projectRunToolCallEvent(
  ctx: MutationCtx,
  run: Doc<"runs">,
  event: AgentRunEvent,
  eventIndex: number,
  now: number,
) {
  if (
    event.type !== "tool.call" &&
    event.type !== "approval.request" &&
    event.type !== "approval.response" &&
    event.type !== "tool.result"
  ) {
    return;
  }
  const existing = await getRunToolCall(ctx, run._id, event.toolCallId);
  switch (event.type) {
    case "tool.call":
      await projectToolCallEvent(ctx, run, event, existing, eventIndex, now);
      break;
    case "approval.request":
      await projectApprovalRequestEvent(ctx, run, event, existing, eventIndex, now);
      break;
    case "approval.response":
      await projectApprovalResponseEvent(ctx, event, existing, eventIndex, now);
      break;
    case "tool.result":
      await projectToolResultEvent(ctx, run, event, existing, eventIndex, now);
      break;
  }
}

async function updateRunToolCalls(
  ctx: MutationCtx,
  run: Doc<"runs">,
  events: AgentRunEvent[],
  startSequence: number,
  now: number,
) {
  for (let offset = 0; offset < events.length; offset++) {
    await projectRunToolCallEvent(
      ctx,
      run,
      events[offset],
      startSequence + offset,
      now,
    );
  }
}

function summarizeRunEvents(run: Doc<"runs">, events: AgentRunEvent[]) {
  let usage = run.usage;
  let output = run.output;
  for (const event of events) {
    switch (event.type) {
      case "usage":
        usage = event.usage;
        break;
      case "done":
        usage = event.usage ?? usage;
        break;
      case "output":
        output = event.value;
        break;
    }
  }
  return { usage, output };
}

async function markOpenRunToolCalls(
  ctx: MutationCtx,
  runId: Id<"runs">,
  status: "failed" | "canceled",
  now: number,
  error?: { code: string; message: string },
) {
  const toolCalls = (
    await Promise.all(
      (["pending", "waiting"] as const).map((openStatus) =>
        ctx.db
          .query("runToolCalls")
          .withIndex("runId_status", (q) =>
            q.eq("runId", runId).eq("status", openStatus),
          )
          .collect(),
      ),
    )
  ).flat();
  for (const toolCall of toolCalls) {
    await ctx.db.patch("runToolCalls", toolCall._id, {
      status,
      error,
      resolvedAt: now,
      updatedAt: now,
    });
  }
}

async function appendRunEvents(
  ctx: MutationCtx,
  run: Doc<"runs">,
  events: AgentRunEvent[],
  startSequence: number,
  idempotencyPrefix = "run-events",
) {
  assert(run.streamId, `Run ${run._id} does not have a stream`);
  const { usage, output } = summarizeRunEvents(run, events);
  const receipt = await runEventStream.appendTail(ctx, {
    streamId: streamId(run.streamId),
    producer: { id: "agent", epoch: 0 },
    idempotencyKey: `${idempotencyPrefix}:v1:${run._id}:${startSequence}`,
    payloadHash: stableHash(events),
    events: events.map((event) => ({ event })),
  });
  assert(
    receipt.firstSequence === startSequence &&
      receipt.firstIndex === startSequence &&
      receipt.lastIndex + 1 === startSequence + events.length &&
      receipt.eventCount === events.length,
    `Run ${run._id} stream indexes do not match Agent event sequence`,
  );
  const now = Date.now();
  await updateRunToolCalls(ctx, run, events, startSequence, now);
  await ctx.db.patch("runs", run._id, {
    nextEventSequence: Math.max(
      run.nextEventSequence,
      startSequence + receipt.eventCount,
    ),
    usage,
    output,
    executionLeaseExpiresAt:
      run.status === "running" ? now + executionLeaseMs : undefined,
    updatedAt: now,
  });
  return receipt;
}

function isClaimExpired(run: Doc<"runs">, now: number) {
  return (
    run.status === "running" &&
    (run.executionLeaseExpiresAt === undefined ||
      run.executionLeaseExpiresAt <= now)
  );
}

function assertClaimed(run: Doc<"runs">, executionId: string) {
  assert(
    run.status === "running" && run.executionId === executionId,
    `Run ${run._id} is not claimed by this execution`,
  );
}

export const get = query({
  args: { runId: v.id("runs") },
  returns: v.union(v.null(), vPublicRun),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    return run ? publicRun(run) : null;
  },
});

export const list = query({
  args: {
    threadId: v.id("threads"),
    statuses: v.optional(v.array(vAgentStatus)),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(vPublicRun),
  handler: async (ctx, args) => {
    const statuses =
      args.statuses && args.statuses.length > 0
        ? args.statuses
        : vAgentStatus.members.map((member) => member.value);
    const runs = await mergedStream(
      statuses.map((status) =>
        dbStream(ctx.db, schema)
          .query("runs")
          .withIndex("threadId_status_createdAt", (q) =>
            q.eq("threadId", args.threadId).eq("status", status),
          )
          .order("desc"),
      ),
      ["createdAt"],
    ).paginate(args.paginationOpts);
    return {
      ...runs,
      page: runs.page.map(publicRun),
    };
  },
});

export const start = mutation({
  args: {
    threadId: v.id("threads"),
    userId: v.optional(v.string()),
    agentName: v.string(),
    prompt: v.optional(v.string()),
    message: v.optional(vAgentMessageInputInternal),
    key: v.optional(v.string()),
  },
  returns: vPublicRun,
  handler: async (ctx, args) => {
    const hash = requestHash(args);
    if (args.key) {
      const existing = await ctx.db
        .query("runs")
        .withIndex("agentName_threadId_key", (q) =>
          q
            .eq("agentName", args.agentName)
            .eq("threadId", args.threadId)
            .eq("key", args.key),
        )
        .first();
      if (existing) {
        if (existing.requestHash !== hash) {
          throw new ConvexError({
            code: "conflictingRunKey",
            message: "Run key was reused with different input.",
          });
        }
        return publicRun(await ensureRunStream(ctx, existing));
      }
    }

    const now = Date.now();
    let messageId: Id<"messages"> | undefined;
    assert(
      args.prompt === undefined || args.message === undefined,
      "Run start accepts either prompt or message, not both",
    );
    if (args.prompt !== undefined || args.message !== undefined) {
      const maxMessage = await getMaxThreadMessage(ctx, args.threadId);
      const message: AgentMessageInputInternal =
        args.message ??
        {
          message: {
            author: { type: "user", userId: args.userId },
            content: [{ type: "text", text: args.prompt! }],
          },
          text: args.prompt,
        };
      messageId = await ctx.db.insert("messages", {
        threadId: args.threadId,
        userId: args.userId,
        order: (maxMessage?.order ?? -1) + 1,
        stepOrder: 0,
        status: message.status ?? "success",
        agentName: args.agentName,
        clientKey: message.clientKey,
        message: message.message,
        tool: isTool(message.message),
        text: extractText(message.message),
        usage: message.usage,
        error: message.error,
      });
    }

    const runId = await ctx.db.insert("runs", {
      threadId: args.threadId,
      userId: args.userId,
      agentName: args.agentName,
      messageId,
      key: args.key,
      requestHash: hash,
      nextEventSequence: 0,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    let run = await ctx.db.get("runs", runId);
    assert(run, "Run was not created");
    run = await ensureRunStream(ctx, run);

    return publicRun(run);
  },
});

export const beginExecution = mutation({
  args: {
    runId: v.id("runs"),
    executionId: v.string(),
  },
  returns: v.object({
    claimed: v.boolean(),
    run: vPublicRun,
    nextEventSequence: v.number(),
  }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    assert(run.streamId, `Run ${args.runId} does not have a stream`);
    if (isTerminal(run.status)) {
      return {
        claimed: false,
        run: publicRun(run),
        nextEventSequence: run.nextEventSequence,
      };
    }
    const now = Date.now();
    if (run.status === "waiting") {
      return {
        claimed: false,
        run: publicRun(run),
        nextEventSequence: run.nextEventSequence,
      };
    }
    if (run.status === "running") {
      if (run.executionId === args.executionId) {
        const projected = await patchRunAndProject(ctx, args.runId, {
          executionLeaseExpiresAt: now + executionLeaseMs,
          updatedAt: now,
        });
        return {
          claimed: true,
          run: projected,
          nextEventSequence: run.nextEventSequence,
        };
      }
      if (!isClaimExpired(run, now)) {
        return {
          claimed: false,
          run: publicRun(run),
          nextEventSequence: run.nextEventSequence,
        };
      }
      const error = {
        code: "executionLeaseExpired",
        message: "Run execution lease expired before completion.",
      };
      await runEventStream.fail(ctx, {
        streamId: streamId(run.streamId),
        error,
      });
      await markOpenRunToolCalls(ctx, args.runId, "failed", now, error);
      const projected = await patchRunAndProject(ctx, args.runId, {
        status: "failed",
        executionId: undefined,
        executionLeaseExpiresAt: undefined,
        error,
        updatedAt: now,
        finishedAt: now,
      });
      return {
        claimed: false,
        run: projected,
        nextEventSequence: run.nextEventSequence,
      };
    }
    const projected = await patchRunAndProject(ctx, args.runId, {
      status: "running",
      executionId: args.executionId,
      executionLeaseExpiresAt: now + executionLeaseMs,
      waiting: undefined,
      error: undefined,
      startedAt: run.startedAt ?? now,
      updatedAt: now,
    });
    return {
      claimed: true,
      run: projected,
      nextEventSequence: run.nextEventSequence,
    };
  },
});

export const appendEvents = mutation({
  args: {
    runId: v.id("runs"),
    executionId: v.string(),
    startSequence: v.number(),
    events: v.array(vAgentRunEvent),
  },
  returns: v.union(vStoppedRunWrite, vAppendedRunEvents),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    assert(run.streamId, `Run ${args.runId} does not have a stream`);
    if (isTerminal(run.status)) {
      return {
        stopped: true as const,
        run: publicRun(run),
        nextEventSequence: run.nextEventSequence,
      };
    }
    assertClaimed(run, args.executionId);
    const receipt = await appendRunEvents(
      ctx,
      run,
      args.events,
      args.startSequence,
    );
    return {
      stopped: false as const,
      firstIndex: receipt.firstIndex,
      lastIndex: receipt.lastIndex,
      eventCount: receipt.eventCount,
      nextEventSequence: args.startSequence + receipt.eventCount,
    };
  },
});

export const finish = mutation({
  args: {
    runId: v.id("runs"),
    executionId: v.string(),
    resultMessageIds: v.optional(v.array(v.id("messages"))),
  },
  returns: vPublicRun,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    if (isTerminal(run.status)) {
      return publicRun(run);
    }
    assertClaimed(run, args.executionId);
    const now = Date.now();
    if (run.streamId) {
      await runEventStream.finish(ctx, { streamId: streamId(run.streamId) });
    }
    return await patchRunAndProject(ctx, args.runId, {
      status: "success",
      executionId: undefined,
      executionLeaseExpiresAt: undefined,
      resultMessageIds: args.resultMessageIds,
      updatedAt: now,
      finishedAt: now,
    });
  },
});

export const fail = mutation({
  args: {
    runId: v.id("runs"),
    executionId: v.string(),
    error: vAgentError,
  },
  returns: vPublicRun,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    if (isTerminal(run.status)) {
      return publicRun(run);
    }
    assertClaimed(run, args.executionId);
    const now = Date.now();
    if (run.streamId) {
      await runEventStream.fail(ctx, {
        streamId: streamId(run.streamId),
        error: args.error,
      });
    }
    await markOpenRunToolCalls(ctx, args.runId, "failed", now, args.error);
    return await patchRunAndProject(ctx, args.runId, {
      status: "failed",
      executionId: undefined,
      executionLeaseExpiresAt: undefined,
      error: args.error,
      updatedAt: now,
      finishedAt: now,
    });
  },
});

export const cancel = mutation({
  args: {
    runId: v.id("runs"),
    reason: v.optional(v.string()),
  },
  returns: vPublicRun,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    if (isTerminal(run.status)) {
      return publicRun(run);
    }
    const now = Date.now();
    if (run.streamId) {
      await runEventStream.cancel(ctx, { streamId: streamId(run.streamId) });
    }
    const error = args.reason
      ? { code: "canceled", message: args.reason }
      : undefined;
    await markOpenRunToolCalls(ctx, args.runId, "canceled", now, error);
    return await patchRunAndProject(ctx, args.runId, {
      status: "canceled",
      executionId: undefined,
      executionLeaseExpiresAt: undefined,
      waiting: undefined,
      error,
      updatedAt: now,
      finishedAt: now,
    });
  },
});

export const requestApproval = mutation({
  args: {
    runId: v.id("runs"),
    executionId: v.string(),
    startSequence: v.number(),
    events: v.array(vAgentRunEvent),
    toolCallIds: v.array(v.string()),
  },
  returns: vPublicRun,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    assert(run.streamId, `Run ${args.runId} does not have a stream`);
    if (isTerminal(run.status)) {
      return publicRun(run);
    }
    assertClaimed(run, args.executionId);
    await appendRunEvents(ctx, run, args.events, args.startSequence);
    const now = Date.now();
    return await patchRunAndProject(ctx, args.runId, {
      status: "waiting",
      executionId: undefined,
      executionLeaseExpiresAt: undefined,
      waiting: { reason: "approval", toolCallIds: args.toolCallIds },
      updatedAt: now,
    });
  },
});

export const listToolCalls = query({
  args: { runId: v.id("runs") },
  returns: v.array(vAgentToolCall),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    const toolCalls = await ctx.db
      .query("runToolCalls")
      .withIndex("runId_requestedAt", (q) => q.eq("runId", run._id))
      .order("asc")
      .collect();
    return toolCalls.map(publicToolCall);
  },
});

function buildStreamReadArgs(
  streamIdValue: string,
  args: { cursor?: string | null; startIndex?: number; numItems: number },
) {
  assert(
    args.cursor === undefined || args.startIndex === undefined,
    "cursor and startIndex are mutually exclusive",
  );
  if (args.cursor !== undefined) {
    return {
      streamId: streamId(streamIdValue),
      cursor: args.cursor,
      numItems: args.numItems,
    };
  }
  if (args.startIndex !== undefined) {
    return {
      streamId: streamId(streamIdValue),
      startIndex: args.startIndex,
      numItems: args.numItems,
    };
  }
  return { streamId: streamId(streamIdValue), numItems: args.numItems };
}

function projectReadResult(
  run: Doc<"runs">,
  result: Awaited<ReturnType<typeof runEventStream.read>>,
) {
  return {
    page: result.page,
    continueCursor: result.continueCursor,
    nextIndex: result.nextIndex,
    isDone: result.isDone,
    upToDate: result.upToDate,
    status: run.status,
    streamStatus: result.status,
    error: run.error ?? result.error,
  };
}

export const readEvents = query({
  args: {
    runId: v.id("runs"),
    cursor: v.optional(v.union(v.string(), v.null())),
    startIndex: v.optional(v.number()),
    numItems: v.number(),
  },
  returns: vReadEventsResult,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    assert(run.streamId, `Run ${args.runId} does not have a stream`);
    const result = await runEventStream.read(
      ctx,
      buildStreamReadArgs(run.streamId, args),
    );
    return projectReadResult(run, result);
  },
});

export const readEventsBatch = query({
  args: {
    reads: v.array(
      v.object({
        runId: v.id("runs"),
        streamArgs: v.object({
          cursor: v.optional(v.union(v.string(), v.null())),
          startIndex: v.optional(v.number()),
          numItems: v.number(),
        }),
      }),
    ),
  },
  returns: vReadEventsBatchResult,
  handler: async (ctx, args) => {
    return await Promise.all(
      args.reads.map(async (read) => {
        const run = await ctx.db.get("runs", read.runId);
        assert(run, `Run not found: ${read.runId}`);
        assert(run.streamId, `Run ${read.runId} does not have a stream`);
        const result = await runEventStream.read(
          ctx,
          buildStreamReadArgs(run.streamId, read.streamArgs),
        );
        return { runId: run._id, ...projectReadResult(run, result) };
      }),
    );
  },
});

export const saveResultMessages = mutation({
  args: {
    runId: v.id("runs"),
    executionId: v.string(),
    messages: v.array(vAgentMessageInputInternal),
  },
  returns: vPublicRun,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    if (isTerminal(run.status)) {
      return publicRun(run);
    }
    assertClaimed(run, args.executionId);
    const result = await addMessagesHandler(ctx, {
      threadId: run.threadId,
      userId: run.userId,
      agentName: run.agentName,
      promptMessageId: run.messageId,
      messages: args.messages,
    });
    const resultMessageIds = [
      ...(run.resultMessageIds ?? []),
      ...result.messages.map((message) => message._id as Id<"messages">),
    ];
    const now = Date.now();
    return await patchRunAndProject(ctx, args.runId, {
      resultMessageIds,
      executionLeaseExpiresAt: now + executionLeaseMs,
      updatedAt: now,
    });
  },
});

export const resolveApproval = mutation({
  args: {
    runId: v.id("runs"),
    toolCallId: v.string(),
    approved: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: vPublicRun,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    assert(run.streamId, `Run ${args.runId} does not have a stream`);
    if (
      run.status !== "waiting" ||
      !run.waiting?.toolCallIds.includes(args.toolCallId)
    ) {
      throw new ConvexError({
        code: "toolCallNotWaiting",
        message: `Tool call ${args.toolCallId} is not waiting for approval.`,
      });
    }
    const toolCall = await getRunToolCall(ctx, run._id, args.toolCallId);
    if (!toolCall || toolCall.status !== "waiting") {
      throw new ConvexError({
        code: "toolCallNotWaiting",
        message: `Tool call ${args.toolCallId} is not waiting for approval.`,
      });
    }
    const waitingToolCallIds =
      run.waiting?.toolCallIds.filter((id) => id !== args.toolCallId) ?? [];
    const now = Date.now();
    await appendRunEvents(
      ctx,
      run,
      [
        {
          type: "approval.response",
          approvalId: toolCall.approvalId ?? `approval:${args.toolCallId}`,
          toolCallId: args.toolCallId,
          approved: args.approved,
          reason: args.reason,
        },
      ],
      run.nextEventSequence,
      "approval",
    );
    return await patchRunAndProject(ctx, args.runId, {
      status: waitingToolCallIds.length === 0 ? "pending" : "waiting",
      executionId: undefined,
      executionLeaseExpiresAt: undefined,
      waiting:
        waitingToolCallIds.length === 0
          ? undefined
          : { reason: "approval", toolCallIds: waitingToolCallIds },
      updatedAt: now,
    });
  },
});

const deleteRunsArgs = {
  threadId: v.id("threads"),
  cursor: v.optional(v.string()),
  limit: v.optional(v.number()),
};
const deleteRunsReturns = {
  cursor: v.string(),
  isDone: v.boolean(),
};

export async function deleteRunsPageForThreadId(
  ctx: MutationCtx,
  args: {
    threadId: Id<"threads">;
    cursor?: string;
    limit?: number;
  },
) {
  const runs = await paginator(ctx.db, schema)
    .query("runs")
    .withIndex("threadId_createdAt", (q) => q.eq("threadId", args.threadId))
    .paginate({
      numItems: args.limit ?? 100,
      cursor: args.cursor ?? null,
    });
  for (const run of runs.page) {
    if (run.streamId) {
      await runEventStream.delete(ctx, { streamId: streamId(run.streamId) });
    }
    const toolCalls = await ctx.db
      .query("runToolCalls")
      .withIndex("runId_requestedAt", (q) => q.eq("runId", run._id))
      .collect();
    for (const toolCall of toolCalls) {
      await ctx.db.delete("runToolCalls", toolCall._id);
    }
    await ctx.db.delete("runs", run._id);
  }
  return {
    cursor: runs.continueCursor,
    isDone: runs.isDone,
  };
}

export const _deletePageForThreadId = internalMutation({
  args: deleteRunsArgs,
  returns: deleteRunsReturns,
  handler: deleteRunsPageForThreadId,
});

export const link = mutation({
  args: {
    runId: v.id("runs"),
    workflowId: v.string(),
  },
  returns: vPublicRun,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    assert(run, `Run not found: ${args.runId}`);
    return await patchRunAndProject(ctx, args.runId, {
      workflowId: args.workflowId,
      updatedAt: Date.now(),
    });
  },
});

export type PublicRun = ReturnType<typeof publicRun>;
export type { AgentRunEvent };
