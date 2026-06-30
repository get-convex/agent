import { streamQueryArgsValidator } from "@convex-dev/stream";
import {
  vAgentRunEvent,
  type AgentMessageInput,
  type AgentContextBlock,
  type AgentContextLoader,
} from "@convex-dev/agent";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import {
  internalAction,
  internalQuery,
  type MutationCtx,
  mutation,
  query,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  caseStatusForRun,
  createRag,
  fallbackUserId,
  fileContextPreviewLength,
  messageText,
  openRouterSupportModel,
  retrievalConfigured,
  runTitle,
  scenarioFor,
  supportKnowledgeVersion,
  type CaseRun,
  type FileDoc,
  vAgentStatus,
  vCaseRun,
  vCaseRunDoc,
  vSessionId,
  workflowModel,
} from "./agent";
import {
  approvalAgent,
  checkSendQuota,
  coreAgent,
  emptyPage,
  filesForMutation,
  findActiveCase,
  getOrCreateActiveCaseForMutation,
  patchCaseStatusForRun,
  rateLimiter,
  recordCaseRunForMutation,
  requireAuthorizedRun,
  scheduleKnowledgeSeedForMutation,
  workflow,
  caller,
} from "./shared";
import { requestMetadata } from "./request";

const rag = createRag(components);

export const vRunEventRead = v.object({
  runId: v.string(),
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
  streamStatus: vAgentStatus,
  error: v.optional(v.object({ code: v.string(), message: v.string() })),
});

function supportKnowledgeContextLoader(): AgentContextLoader {
  return async (ctx, { run, promptMessage }) => {
    const userId = run.userId ?? fallbackUserId;
    if (!retrievalConfigured()) {
      return [];
    }
    const seed = await ctx.runQuery(internal.support.knowledge.getSeed, {
      userId,
      version: supportKnowledgeVersion,
    });
    if (seed?.status !== "ready") {
      return [];
    }
    const queryText = promptMessage ? messageText(promptMessage) : "support case";
    let result;
    try {
      result = await rag.search(ctx, {
        namespace: userId,
        query: queryText,
        limit: 3,
        searchType: "hybrid",
        filters: [{ name: "source", value: "support" }],
        chunkContext: { before: 1, after: 1 },
      });
    } catch {
      return [];
    }
    const blocks: AgentContextBlock[] = result.entries.map((entry) => ({
      type: "text",
      name: entry.title ?? "Support knowledge",
      text: entry.text,
      metadata: {
        source: "support",
        entryId: entry.entryId,
        key: entry.key,
        resultCount: result.results.length,
      },
    }));
    await ctx.runMutation(internal.support.context.recordBlocks, {
      userId,
      runId: run.runId,
      source: "support",
      blocks,
    });
    return blocks;
  };
}

function fileCorpusContextLoader(): AgentContextLoader {
  return async (ctx, { run, promptMessage }) => {
    if (!retrievalConfigured()) return [];
    const queryText = promptMessage ? messageText(promptMessage) : "support case";
    const userId = run.userId ?? fallbackUserId;
    let result;
    try {
      result = await rag.search(ctx, {
        namespace: userId,
        query: queryText,
        limit: 2,
        searchType: "hybrid",
        filters: [{ name: "source", value: "file" }],
        chunkContext: { before: 1, after: 1 },
      });
    } catch {
      return [];
    }
    const blocks: AgentContextBlock[] = result.entries.map((entry) => ({
      type: "text",
      name: entry.title ? `Previous file: ${entry.title}` : "Previous file",
      text: entry.text,
      metadata: {
        source: "file-corpus",
        entryId: entry.entryId,
        fileId: entry.metadata?.fileId,
        mediaType: entry.metadata?.mediaType,
        resultCount: result.results.length,
      },
    }));
    await ctx.runMutation(internal.support.context.recordBlocks, {
      userId,
      runId: run.runId,
      source: "file-corpus",
      blocks,
    });
    return blocks;
  };
}

function fileContextLoader(fileRefs: Id<"files">[]): AgentContextLoader {
  return async (ctx, { run }) => {
    const maybeFiles: Array<FileDoc | null> = await Promise.all(
      fileRefs.map((fileId) =>
        ctx.runQuery(internal.support.files.get, {
          fileId,
          userId: run.userId ?? fallbackUserId,
        }),
      ),
    );
    const files = maybeFiles.filter((file): file is FileDoc => file !== null);
    const blocks: AgentContextBlock[] = files.map((file) => {
      const extractionStatus = file.extractionStatus ?? "metadataOnly";
      return {
        type: "text",
        name: `File: ${file.filename}`,
        text:
          extractionStatus === "extracted" && file.extractedText
            ? `File: ${file.filename}\n\n${file.extractedText.slice(0, fileContextPreviewLength)}`
            : `File: ${file.filename}\n\n${file.summary}`,
        metadata: {
          fileId: file._id,
          extractionStatus,
          storageId: file.storageId,
          mediaType: file.mediaType,
          size: file.size,
          textLength: file.textLength,
          truncated: file.truncated,
          url: file.url,
        },
      };
    });
    await ctx.runMutation(internal.support.context.recordBlocks, {
      userId: run.userId ?? fallbackUserId,
      runId: run.runId,
      source: "file",
      blocks,
    });
    return blocks;
  };
}

function executionContextLoaders(meta: { fileRefs: Id<"files">[] }) {
  const loaders: AgentContextLoader[] = [];
  if (retrievalConfigured()) {
    loaders.push(supportKnowledgeContextLoader());
  }
  if (meta.fileRefs.length > 0) {
    loaders.push(fileContextLoader(meta.fileRefs));
  } else if (retrievalConfigured()) {
    loaders.push(fileCorpusContextLoader());
  }
  return loaders;
}

export async function startSupportRun(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    clientMessageId: string;
    prompt: string;
    fileRefs?: Id<"files">[];
    useWorkflow?: boolean;
    message?: AgentMessageInput;
  },
): Promise<CaseRun> {
  const current = caller(args);
  const metadata = await requestMetadata(ctx);
  const fileRefs = args.fileRefs ?? [];
  const files = await filesForMutation(ctx, current.userId, fileRefs);
  const existing = await ctx.db
    .query("caseRuns")
    .withIndex("by_user_clientMessageId", (q) =>
      q.eq("userId", current.userId).eq("clientMessageId", args.clientMessageId),
    )
    .first();
  if (!existing) {
    await checkSendQuota(ctx, current.userId, metadata.clientIp);
  }

  const title = runTitle(args.prompt);
  const supportCase = await getOrCreateActiveCaseForMutation(
    ctx,
    current.userId,
    title,
  );
  const scenario = scenarioFor({ prompt: args.prompt, fileRefs });
  const run = await coreAgent.runs.start(ctx, {
    threadId: supportCase.threadId,
    userId: current.userId,
    key: `client-message:${args.clientMessageId}`,
    message:
      args.message !== undefined
        ? messageWithFiles(args.message, files)
        : messageForPrompt({
            clientMessageId: args.clientMessageId,
            prompt: args.prompt,
            userId: current.userId,
            files,
          }),
  });
  if (existing) {
    return run;
  }

  const baseCaseRun = {
    userId: current.userId,
    clientMessageId: args.clientMessageId,
    scenario,
    title,
    fileRefs,
    requestMetadata: metadata,
  };
  await recordCaseRunForMutation(ctx, {
    ...baseCaseRun,
    runId: run.runId,
    threadId: run.threadId,
    messageId: run.messageId,
    streamId: run.streamId,
  });
  await ctx.db.patch("cases", supportCase._id, {
    lastRunId: run.runId,
    status: "drafting",
    updatedAt: Date.now(),
  });
  if (retrievalConfigured()) {
    await scheduleKnowledgeSeedForMutation(ctx, current.userId);
  }
  if (args.useWorkflow === true) {
    const workflowId = await workflow.start(ctx, internal.support.workflow.workflowRun, {
      runId: run.runId,
    });
    const linked = await coreAgent.runs.link(ctx, { runId: run.runId, workflowId });
    await recordCaseRunForMutation(ctx, {
      ...baseCaseRun,
      runId: linked.runId,
      threadId: linked.threadId,
      messageId: linked.messageId,
      streamId: linked.streamId,
      workflowId,
    });
    return linked;
  }
  await ctx.scheduler.runAfter(0, internal.support.runs.execute, {
    runId: run.runId,
  });
  return run;
}

function messageForPrompt(args: {
  clientMessageId: string;
  prompt: string;
  userId: string;
  files: FileDoc[];
}): AgentMessageInput {
  return {
    clientKey: args.clientMessageId,
    message: {
      author: { type: "user", userId: args.userId },
      content: [
        { type: "text", text: args.prompt },
        ...args.files.map((file) => ({
          type: "file" as const,
          fileId: file._id,
          url: file.url,
          mediaType: file.mediaType,
          filename: file.filename,
        })),
      ],
    },
    text: args.prompt,
  };
}

function messageWithFiles(
  message: AgentMessageInput,
  files: FileDoc[],
): AgentMessageInput {
  if (files.length === 0) {
    return message;
  }
  return {
    ...message,
    message: {
      ...message.message,
      content: [
        ...message.message.content,
        ...files.map((file) => ({
          type: "file" as const,
          fileId: file._id,
          url: file.url,
          mediaType: file.mediaType,
          filename: file.filename,
        })),
      ],
    },
  };
}

export const sendMessage = mutation({
  args: {
    sessionId: vSessionId,
    clientMessageId: v.string(),
    prompt: v.string(),
    fileRefs: v.optional(v.array(v.id("files"))),
    useWorkflow: v.optional(v.boolean()),
  },
  returns: vCaseRun,
  handler: async (ctx, args) => {
    return await startSupportRun(ctx, args);
  },
});

export const get = query({
  args: {
    sessionId: vSessionId,
    runId: v.string(),
  },
  returns: v.union(v.null(), vCaseRun),
  handler: async (ctx, args) => {
    const current = caller(args);
    const { run } = await requireAuthorizedRun(ctx, args.runId, current.userId);
    return run;
  },
});

export const list = query({
  args: {
    sessionId: vSessionId,
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(vCaseRun),
  handler: async (ctx, args) => {
    const current = caller(args);
    const supportCase = await findActiveCase(ctx, current.userId);
    if (!supportCase) {
      return emptyPage;
    }
    return await coreAgent.runs.list(ctx, {
      threadId: supportCase.threadId,
      paginationOpts: args.paginationOpts,
    });
  },
});

export const readEventsBatch = query({
  args: {
    sessionId: vSessionId,
    reads: v.array(
      v.object({
        runId: v.string(),
        streamArgs: streamQueryArgsValidator,
      }),
    ),
  },
  returns: v.array(vRunEventRead),
  handler: async (ctx, args) => {
    const current = caller(args);
    await Promise.all(
      args.reads.map((read) =>
        requireAuthorizedRun(ctx, read.runId, current.userId),
      ),
    );
    return await coreAgent.events.readBatch(ctx, { reads: args.reads });
  },
});

export async function cancelSupportRun(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    runId: string;
    reason?: string;
  },
): Promise<CaseRun> {
  const current = caller(args);
  await requireAuthorizedRun(ctx, args.runId, current.userId);
  const run = await coreAgent.runs.cancel(ctx, {
    runId: args.runId,
    reason: args.reason,
  });
  await patchCaseStatusForRun(ctx, current.userId, run, caseStatusForRun(run));
  return run;
}

export const cancel = mutation({
  args: {
    sessionId: vSessionId,
    runId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: vCaseRun,
  handler: async (ctx, args) => {
    return await cancelSupportRun(ctx, args);
  },
});

export const getCaseRun = internalQuery({
  args: { runId: v.string() },
  returns: v.union(vCaseRunDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("caseRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique();
  },
});

export const execute = internalAction({
  args: { runId: v.string() },
  returns: vCaseRun,
  handler: async (ctx, args): Promise<CaseRun> => {
    const meta: Doc<"caseRuns"> | null = await ctx.runQuery(
      internal.support.runs.getCaseRun,
      {
        runId: args.runId,
      },
    );
    if (!meta) {
      throw new Error("Run metadata not found");
    }
    const tokenStatus = await rateLimiter.limit(ctx, "executeTokens", {
      key: meta.userId,
      count: 32,
    });
    if (!tokenStatus.ok) {
      throw new Error("Execute-side quota exhausted.");
    }
    const run: CaseRun =
      meta.scenario === "approval"
        ? await approvalAgent.runs.execute(ctx, {
            runId: args.runId,
          })
        : await coreAgent.runs.execute(ctx, {
            runId: args.runId,
            model: openRouterSupportModel,
            context: executionContextLoaders(meta),
          });
    await ctx.runMutation(internal.support.cases.updateForRun, {
      userId: meta.userId,
      threadId: run.threadId,
      runId: run.runId,
      status: caseStatusForRun(run),
    });
    return run;
  },
});

export const executeWorkflowRun = internalAction({
  args: { runId: v.string() },
  returns: vCaseRun,
  handler: async (ctx, args): Promise<CaseRun> => {
    const result: CaseRun = await coreAgent.runs.execute(ctx, {
      runId: args.runId,
      model: workflowModel,
    });
    await ctx.runMutation(internal.support.cases.updateForRun, {
      userId: result.userId ?? fallbackUserId,
      threadId: result.threadId,
      runId: result.runId,
      status: caseStatusForRun(result),
    });
    return result;
  },
});
