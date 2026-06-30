import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import {
  vAgentStatus,
  vCaseRun,
  vSessionId,
} from "./agent";
import {
  approvalAgent,
  caller,
  patchCaseStatusForRun,
  requireAuthorizedRun,
} from "./shared";
import { internal } from "../_generated/api";

const vToolCall = v.object({
  toolCallId: v.string(),
  runId: v.string(),
  name: v.string(),
  input: v.any(),
  status: vAgentStatus,
  approvalId: v.optional(v.string()),
  approved: v.optional(v.boolean()),
  reason: v.optional(v.string()),
  output: v.optional(v.any()),
  error: v.optional(v.object({ code: v.string(), message: v.string() })),
  requestedAt: v.number(),
  resolvedAt: v.optional(v.number()),
});

export const list = query({
  args: {
    sessionId: vSessionId,
    runId: v.string(),
  },
  returns: v.array(vToolCall),
  handler: async (ctx, args) => {
    const current = caller(args);
    await requireAuthorizedRun(ctx, args.runId, current.userId);
    return await approvalAgent.tools.list(ctx, { runId: args.runId });
  },
});

export const approve = mutation({
  args: {
    sessionId: vSessionId,
    runId: v.string(),
    toolCallId: v.string(),
  },
  returns: vCaseRun,
  handler: async (ctx, args) => {
    const current = caller(args);
    await requireAuthorizedRun(ctx, args.runId, current.userId);
    const run = await approvalAgent.tools.approve(ctx, {
      runId: args.runId,
      toolCallId: args.toolCallId,
      reason: "Approved from the support UI.",
    });
    await ctx.scheduler.runAfter(0, internal.support.runs.execute, {
      runId: args.runId,
    });
    await patchCaseStatusForRun(ctx, current.userId, run, "drafting");
    return run;
  },
});

export const deny = mutation({
  args: {
    sessionId: vSessionId,
    runId: v.string(),
    toolCallId: v.string(),
  },
  returns: vCaseRun,
  handler: async (ctx, args) => {
    const current = caller(args);
    await requireAuthorizedRun(ctx, args.runId, current.userId);
    const run = await approvalAgent.tools.deny(ctx, {
      runId: args.runId,
      toolCallId: args.toolCallId,
      reason: "Denied from the support UI.",
    });
    await ctx.scheduler.runAfter(0, internal.support.runs.execute, {
      runId: args.runId,
    });
    await patchCaseStatusForRun(ctx, current.userId, run, "drafting");
    return run;
  },
});
