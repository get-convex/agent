import { components, internal } from "../_generated/api";
import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  callerFromSession,
  createApprovalAgent,
  createCoreAgent,
  createRateLimiter,
  createWorkflow,
  fileSummary,
  supportKnowledgeVersion,
  type FileDoc,
  type SupportCase,
} from "./agent";
import type { RequestMetadata } from "./request";

export const coreAgent = createCoreAgent(components);
export const approvalAgent = createApprovalAgent(components);
export const rateLimiter = createRateLimiter(components);
export const workflow = createWorkflow(components);

export const emptyPage = { page: [], continueCursor: "", isDone: true };

export async function checkSendQuota(
  ctx: Parameters<typeof rateLimiter.limit>[0],
  userId: string,
  clientIp: string | undefined,
) {
  const status = await rateLimiter.limit(ctx, "sendRun", { key: userId });
  if (!status.ok) {
    throw new Error(
      `Send quota exhausted. Retry in ${Math.ceil((status.retryAfter ?? 0) / 1000)}s.`,
    );
  }
  if (clientIp) {
    const ipStatus = await rateLimiter.limit(ctx, "sendRunIp", {
      key: clientIp,
    });
    if (!ipStatus.ok) {
      throw new Error(
        `Network send quota exhausted. Retry in ${Math.ceil((ipStatus.retryAfter ?? 0) / 1000)}s.`,
      );
    }
  }
}

export async function requireAuthorizedRun(
  ctx: Pick<QueryCtx | ActionCtx, "runQuery">,
  runId: string,
  userId: string,
) {
  const run = await coreAgent.runs.get(ctx, { runId });
  if (!run || run.userId !== userId) {
    throw new Error("Run not found");
  }
  return { run };
}

export function patchCaseStatusForRun(
  ctx: Pick<MutationCtx, "runMutation">,
  userId: string,
  run: { threadId: string; runId: string },
  status: SupportCase["status"],
) {
  return ctx.runMutation(internal.support.cases.updateForRun, {
    userId,
    threadId: run.threadId,
    runId: run.runId,
    status,
  });
}

export function contextBlocksForRun(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  runId: string,
) {
  return ctx.db
    .query("contextBlocks")
    .withIndex("by_user_runId", (q) =>
      q.eq("userId", userId).eq("runId", runId),
    )
    .collect();
}

export function findActiveCase(ctx: QueryCtx | MutationCtx, userId: string) {
  return ctx.db
    .query("cases")
    .withIndex("by_user_active", (q) => q.eq("userId", userId).eq("active", true))
    .first();
}

export function toSupportCase(doc: Doc<"cases">): SupportCase {
  return {
    threadId: doc.threadId,
    title: doc.title,
    status: doc.status,
    lastRunId: doc.lastRunId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function createCase(
  ctx: MutationCtx,
  userId: string,
  title: string,
): Promise<Doc<"cases">> {
  const thread = await coreAgent.threads.create(ctx, { userId, title });
  const now = Date.now();
  const caseId = await ctx.db.insert("cases", {
    userId,
    threadId: thread._id,
    title,
    status: "open",
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get("cases", caseId);
  if (!created) {
    throw new Error("Failed to create case");
  }
  return created;
}

export async function getOrCreateActiveCaseForMutation(
  ctx: MutationCtx,
  userId: string,
  title: string,
): Promise<Doc<"cases">> {
  const existing = await findActiveCase(ctx, userId);
  return existing ?? (await createCase(ctx, userId, title));
}

export async function recordCaseRunForMutation(
  ctx: MutationCtx,
  args: {
    userId: string;
    clientMessageId: string;
    scenario: string;
    title: string;
    runId: string;
    threadId: string;
    messageId?: string;
    streamId: string;
    fileRefs: Id<"files">[];
    workflowId?: string;
    requestMetadata?: RequestMetadata;
  },
) {
  const existing = await ctx.db
    .query("caseRuns")
    .withIndex("by_runId", (q) => q.eq("runId", args.runId))
    .unique();
  if (existing) {
    await ctx.db.patch("caseRuns", existing._id, {
      workflowId: args.workflowId ?? existing.workflowId,
      clientIp: args.requestMetadata?.clientIp ?? existing.clientIp,
      userAgent: args.requestMetadata?.userAgent ?? existing.userAgent,
      requestId: args.requestMetadata?.requestId ?? existing.requestId,
    });
    return existing._id;
  }
  return await ctx.db.insert("caseRuns", {
    userId: args.userId,
    clientMessageId: args.clientMessageId,
    scenario: args.scenario,
    title: args.title,
    runId: args.runId,
    threadId: args.threadId,
    messageId: args.messageId,
    streamId: args.streamId,
    workflowId: args.workflowId,
    fileRefs: args.fileRefs,
    clientIp: args.requestMetadata?.clientIp,
    userAgent: args.requestMetadata?.userAgent,
    requestId: args.requestMetadata?.requestId,
    createdAt: Date.now(),
  });
}

export async function filesForMutation(
  ctx: MutationCtx,
  userId: string,
  fileRefs: Id<"files">[],
) {
  const files = (
    await Promise.all(fileRefs.map((fileId) => ctx.db.get("files", fileId)))
  ).filter((file): file is FileDoc => file !== null && file.userId === userId);
  if (files.length !== fileRefs.length) {
    throw new Error("File reference not found");
  }
  return files;
}

export async function scheduleKnowledgeSeedForMutation(
  ctx: MutationCtx,
  userId: string,
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("knowledgeSeeds")
    .withIndex("by_user_version", (q) =>
      q.eq("userId", userId).eq("version", supportKnowledgeVersion),
    )
    .unique();
  if (existing) {
    await ctx.db.patch("knowledgeSeeds", existing._id, {
      status: existing.status === "ready" ? "ready" : "pending",
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("knowledgeSeeds", {
      userId,
      version: supportKnowledgeVersion,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }
  await ctx.scheduler.runAfter(0, internal.support.knowledge.seedSupportKnowledge, {
    userId,
    version: supportKnowledgeVersion,
  });
}

export function summaryForUploadedFile(args: {
  extractionStatus: "extracted" | "metadataOnly" | "failed";
  filename: string;
  size: number;
  textLength?: number;
  summary?: string;
}) {
  return (
    args.summary ??
    fileSummary({
      extractionStatus: args.extractionStatus,
      filename: args.filename,
      size: args.size,
      textLength: args.textLength,
    })
  );
}

export function caller(args: { sessionId: string }) {
  return callerFromSession(args);
}
