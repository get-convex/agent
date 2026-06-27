import { query } from "../_generated/server";
import { v } from "convex/values";
import {
  configuredModelProvider,
  type ModelProvider,
  vQuotaSnapshot,
  vSessionId,
} from "./agent";
import {
  caller,
  contextBlocksForRun,
  rateLimiter,
  requireAuthorizedRun,
} from "./shared";
import { quotaSnapshot } from "./agent";

export const list = query({
  args: { sessionId: vSessionId, runId: v.string() },
  returns: v.array(
    v.object({
      label: v.string(),
      status: v.string(),
      timestamp: v.optional(v.number()),
      detail: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    const current = caller(args);
    const { run } = await requireAuthorizedRun(ctx, args.runId, current.userId);
    const meta = await ctx.db
      .query("caseRuns")
      .withIndex("by_runId", (q) => q.eq("runId", run.runId))
      .unique();
    const contextBlocks = await contextBlocksForRun(ctx, current.userId, run.runId);
    const provider: ModelProvider =
      meta?.scenario === "approval"
        ? { kind: "fallback", model: "deterministic" }
        : configuredModelProvider();
    const runDetail = {
      runId: run.runId,
      threadId: run.threadId,
      streamId: run.streamId,
      messageId: run.messageId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
    const contextDetail = contextBlocks.map((block) => ({
      source: block.source,
      name: block.name,
      textLength: block.text.length,
      preview:
        block.text.length > 500 ? `${block.text.slice(0, 500)}...` : block.text,
      metadata: block.metadata,
    }));
    return [
      {
        label: "Message saved",
        status: "done",
        timestamp: run.createdAt,
        detail: { messageId: run.messageId, threadId: run.threadId },
      },
      {
        label: "Model provider",
        status: provider.kind,
        detail: provider,
      },
      {
        label: "Run started",
        status: run.startedAt ? "done" : "pending",
        timestamp: run.startedAt,
        detail: runDetail,
      },
      {
        label: "Context loaded",
        status: contextBlocks.length > 0 ? "done" : "skipped",
        detail: contextDetail,
      },
      {
        label: "HTTP stream",
        status: run.status,
        detail: { streamId: run.streamId },
      },
      ...(meta?.clientIp || meta?.userAgent || meta?.requestId
        ? [
            {
              label: "Request metadata",
              status: meta.clientIp ? "captured" : "partial",
              detail: {
                ip: meta.clientIp,
                userAgent: meta.userAgent,
                requestId: meta.requestId,
              },
            },
          ]
        : []),
      ...(meta?.workflowId
        ? [
            {
              label: "App orchestration",
              status: "linked",
              detail: { workflowId: meta.workflowId },
            },
          ]
        : []),
    ];
  },
});

export const getRateLimitStatus = query({
  args: { sessionId: vSessionId },
  returns: v.object({
    sendRun: vQuotaSnapshot,
    executeTokens: vQuotaSnapshot,
  }),
  handler: async (ctx, args) => {
    const current = caller(args);
    const sendRun = await rateLimiter.getValue(ctx, "sendRun", {
      key: current.userId,
    });
    const executeTokens = await rateLimiter.getValue(ctx, "executeTokens", {
      key: current.userId,
    });
    return {
      sendRun: quotaSnapshot(sendRun),
      executeTokens: quotaSnapshot(executeTokens),
    };
  },
});
