import { streamQueryArgsValidator } from "@convex-dev/stream";
import type { AgentMessageInput } from "@convex-dev/agent";
import {
  vAgentMessageDoc,
  vAgentMessageInput,
} from "@convex-dev/agent/validators";
import { v, type Value } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { vCaseRun, vSessionId } from "./agent";
import { caller, coreAgent, findActiveCase, requireAuthorizedRun } from "./shared";
import {
  cancelSupportRun,
  startSupportRun,
  vRunEventRead,
} from "./runs";

const activeStatuses = new Set(["pending", "running", "waiting"]);

type ChatBody = {
  clientMessageId?: string;
  fileRefs?: Id<"files">[];
  useWorkflow?: boolean;
};

export const list = query({
  args: {
    sessionId: vSessionId,
  },
  returns: v.array(vAgentMessageDoc),
  handler: async (ctx, args) => {
    const current = caller(args);
    const supportCase = await findActiveCase(ctx, current.userId);
    if (!supportCase) {
      return [];
    }
    const page = await coreAgent.messages.list(ctx, {
      threadId: supportCase.threadId,
      order: "desc",
      paginationOpts: { cursor: null, numItems: 50 },
    });
    return page.page.toReversed();
  },
});

export const send = mutation({
  args: {
    sessionId: vSessionId,
    chatId: v.string(),
    trigger: v.union(v.literal("submit-message"), v.literal("regenerate-message")),
    messageId: v.optional(v.string()),
    message: vAgentMessageInput,
    messages: v.array(v.any()),
    body: v.optional(v.any()),
    metadata: v.optional(v.any()),
  },
  returns: vCaseRun,
  handler: async (ctx, args) => {
    const current = caller(args);
    const body = parseBody(args.body);
    const message = withUserId(args.message, current.userId);
    const prompt = textFromMessage(message) || "Please review this.";
    return await startSupportRun(ctx, {
      sessionId: args.sessionId,
      clientMessageId:
        body.clientMessageId ??
        args.message.clientKey ??
        args.messageId ??
        args.chatId,
      prompt,
      fileRefs: body.fileRefs,
      useWorkflow: body.useWorkflow,
      message,
    });
  },
});

export const read = query({
  args: {
    sessionId: vSessionId,
    runId: v.string(),
    streamArgs: streamQueryArgsValidator,
  },
  returns: vRunEventRead,
  handler: async (ctx, args) => {
    const current = caller(args);
    await requireAuthorizedRun(ctx, args.runId, current.userId);
    const read = await coreAgent.events.read(ctx, {
      runId: args.runId,
      ...args.streamArgs,
    });
    return { runId: args.runId, ...read };
  },
});

export const resume = query({
  args: {
    sessionId: vSessionId,
    chatId: v.string(),
    body: v.optional(v.any()),
    metadata: v.optional(v.any()),
  },
  returns: v.union(vCaseRun, v.null()),
  handler: async (ctx, args) => {
    const current = caller(args);
    const supportCase = await findActiveCase(ctx, current.userId);
    if (!supportCase?.lastRunId) {
      return null;
    }
    const run = await coreAgent.runs.get(ctx, { runId: supportCase.lastRunId });
    if (
      !run ||
      run.userId !== current.userId ||
      !activeStatuses.has(run.status)
    ) {
      return null;
    }
    return run;
  },
});

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

function parseBody(value: Value | undefined): ChatBody {
  if (!isRecord(value)) {
    return {};
  }
  const fileRefs = Array.isArray(value.fileRefs)
    ? value.fileRefs.filter((fileRef): fileRef is Id<"files"> =>
        typeof fileRef === "string",
      )
    : undefined;
  return {
    clientMessageId:
      typeof value.clientMessageId === "string"
        ? value.clientMessageId
        : undefined,
    fileRefs,
    useWorkflow:
      typeof value.useWorkflow === "boolean" ? value.useWorkflow : undefined,
  };
}

function withUserId(
  message: AgentMessageInput,
  userId: string,
): AgentMessageInput {
  if (message.message.author.type !== "user") {
    return message;
  }
  return {
    ...message,
    message: {
      ...message.message,
      author: { type: "user", userId },
    },
  };
}

function textFromMessage(message: AgentMessageInput) {
  return message.message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
