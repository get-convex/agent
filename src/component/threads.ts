import { assert, pick } from "convex-helpers";
import { paginator } from "convex-helpers/server/pagination";
import { partial } from "convex-helpers/validators";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { ObjectType } from "convex/values";
import { type ThreadDoc, vThreadDoc } from "../validators.js";
import { api, internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import {
  action,
  internalMutation,
  mutation,
  type MutationCtx,
  query,
} from "./_generated/server.js";
import { deleteMessage } from "./messages.js";
import { deleteRunsPageForThreadId } from "./runs.js";
import { schema, v } from "./schema.js";

function publicThreadOrNull(thread: Doc<"threads"> | null): ThreadDoc | null {
  if (thread === null) {
    return null;
  }
  return publicThread(thread);
}

function publicThread(thread: Doc<"threads">): ThreadDoc {
  return thread;
}

export const getThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return publicThreadOrNull(await ctx.db.get("threads", args.threadId));
  },
  returns: v.union(vThreadDoc, v.null()),
});

export const listThreadsByUserId = query({
  args: {
    userId: v.optional(v.string()),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (ctx, args) => {
    const threads = await paginator(ctx.db, schema)
      .query("threads")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .order(args.order ?? "desc")
      .paginate(args.paginationOpts ?? { cursor: null, numItems: 100 });
    return {
      ...threads,
      page: threads.page.map(publicThread),
    };
  },
  returns: paginationResultValidator(vThreadDoc),
});

const vThread = schema.tables.threads.validator;

export const createThread = mutation({
  args: {
    userId: v.optional(v.string()),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const threadId = await ctx.db.insert("threads", {
      ...args,
      status: "active",
    });
    return publicThread((await ctx.db.get("threads", threadId))!);
  },
  returns: vThreadDoc,
});

export const threadFieldsSupportingPatch = [
  "title" as const,
  "summary" as const,
  "status" as const,
  "userId" as const,
];

export const updateThread = mutation({
  args: {
    threadId: v.id("threads"),
    patch: v.object(partial(pick(vThread.fields, threadFieldsSupportingPatch))),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("threads", args.threadId);
    assert(thread, `Thread ${args.threadId} not found`);
    await ctx.db.patch("threads", args.threadId, args.patch);
    return publicThread((await ctx.db.get("threads", args.threadId))!);
  },
  returns: vThreadDoc,
});

export const searchThreadTitles = query({
  args: {
    query: v.string(),
    userId: v.optional(v.union(v.string(), v.null())),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("threads")
      .withSearchIndex("title", (q) =>
        args.userId !== undefined && args.userId !== null
          ? q.search("title", args.query).eq("userId", args.userId)
          : q.search("title", args.query),
      )
      .take(args.limit);
    return threads.map(publicThread);
  },
  returns: v.array(vThreadDoc),
});

/**
 * Use this to delete a thread and everything it contains.
 * It will try to delete all pages synchronously.
 * If it times out or fails, you'll have to run it again.
 */
export const deleteAllForThreadIdSync = action({
  args: { threadId: v.id("threads"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let messageCursor: string | undefined = undefined;
    while (true) {
      const result: DeleteThreadReturns = await ctx.runMutation(
        internal.threads._deletePageForThreadId,
        { threadId: args.threadId, cursor: messageCursor, limit: args.limit },
      );
      if (result.isDone) {
        break;
      }
      messageCursor = result.cursor;
    }
    let runCursor: string | undefined = undefined;
    while (true) {
      const result: DeleteThreadReturns = await ctx.runMutation(
        internal.runs._deletePageForThreadId,
        { threadId: args.threadId, cursor: runCursor, limit: args.limit },
      );
      if (result.isDone) {
        break;
      }
      runCursor = result.cursor;
    }
    await ctx.runMutation(internal.threads._deleteThreadIfDone, {
      threadId: args.threadId,
    });
  },
  returns: v.null(),
});

const deleteThreadArgs = {
  threadId: v.id("threads"),
  cursor: v.optional(v.string()),
  runCursor: v.optional(v.string()),
  messagesDone: v.optional(v.boolean()),
  runsDone: v.optional(v.boolean()),
  limit: v.optional(v.number()),
};
type DeleteThreadArgs = ObjectType<typeof deleteThreadArgs>;
const deleteThreadReturns = {
  cursor: v.string(),
  isDone: v.boolean(),
};
type DeleteThreadReturns = ObjectType<typeof deleteThreadReturns>;

export const _deletePageForThreadId = internalMutation({
  args: deleteThreadArgs,
  handler: deletePageForThreadIdHandler,
  returns: deleteThreadReturns,
});

export const _deleteThreadIfDone = internalMutation({
  args: { threadId: v.id("threads") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteThreadIfDone(ctx, args.threadId);
    return null;
  },
});

/**
 * Use this to delete a thread and everything it contains.
 * It will continue deleting pages asynchronously.
 */
export const deleteAllForThreadIdAsync = mutation({
  args: deleteThreadArgs,
  handler: async (ctx, args) => {
    let messagesResult = {
      isDone: args.messagesDone ?? false,
      cursor: args.cursor,
    };
    if (!args.messagesDone) {
      messagesResult = await deletePageForThreadIdHandler(ctx, args);
    }
    let runsResult = {
      isDone: args.runsDone ?? false,
      cursor: args.runCursor,
    };
    if (!args.runsDone) {
      runsResult = await deleteRunsPageForThreadId(ctx, {
        threadId: args.threadId,
        cursor: args.runCursor,
        limit: args.limit,
      });
    }
    const isDone = messagesResult.isDone && runsResult.isDone;
    if (!isDone) {
      await ctx.scheduler.runAfter(0, api.threads.deleteAllForThreadIdAsync, {
        threadId: args.threadId,
        cursor: messagesResult.cursor,
        runCursor: runsResult.cursor,
        messagesDone: messagesResult.isDone,
        runsDone: runsResult.isDone,
      });
    } else {
      await deleteThreadIfDone(ctx, args.threadId);
    }
    return { isDone };
  },
  returns: v.object({ isDone: v.boolean() }),
});

async function deletePageForThreadIdHandler(
  ctx: MutationCtx,
  args: DeleteThreadArgs,
): Promise<DeleteThreadReturns> {
  const messages = await paginator(ctx.db, schema)
    .query("messages")
    .withIndex("threadId_status_tool_order_stepOrder", (q) =>
      q.eq("threadId", args.threadId),
    )
    .paginate({
      numItems: args.limit ?? 100,
      cursor: args.cursor ?? null,
    });
  await Promise.all(messages.page.map((m) => deleteMessage(ctx, m)));
  if (messages.isDone) await deleteThreadIfDone(ctx, args.threadId);
  return {
    cursor: messages.continueCursor,
    isDone: messages.isDone,
  };
}

async function deleteThreadIfDone(
  ctx: MutationCtx,
  threadId: Doc<"threads">["_id"],
) {
  const message = await ctx.db
    .query("messages")
    .withIndex("threadId_status_tool_order_stepOrder", (q) =>
      q.eq("threadId", threadId),
    )
    .first();
  if (message) return;
  const run = await ctx.db
    .query("runs")
    .withIndex("threadId_createdAt", (q) => q.eq("threadId", threadId))
    .first();
  if (run) return;
  const thread = await ctx.db.get("threads", threadId);
  if (thread) {
    await ctx.db.delete("threads", threadId);
  }
}
