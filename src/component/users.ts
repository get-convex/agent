import { paginator } from "convex-helpers/server/pagination";
import { stream } from "convex-helpers/server/stream";
import { nullable } from "convex-helpers/validators";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { ObjectType } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
} from "./_generated/server.js";
import { deleteMessage } from "./messages.js";
import { deleteRunsPageForThreadId } from "./runs.js";
import { schema, v } from "./schema.js";

// Note: it only searches for users with threads
export const listUsersWithThreads = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const results = await stream(ctx.db, schema)
      .query("threads")
      .withIndex("userId", (q) => q.gt("userId", ""))
      .distinct(["userId"])
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: results.page.map((t) => t.userId).filter((t): t is string => !!t),
    };
  },
  returns: paginationResultValidator(v.string()),
});

export const deleteAllForUserId = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    let threadsCursor = null;
    let threadInProgress = null;
    let messagesCursor = null;
    let runCursor = null;
    let isDone = false;
    while (!isDone) {
      const result: DeleteAllReturns = await ctx.runMutation(
        internal.users._deletePageForUserId,
        {
          userId: args.userId,
          messagesCursor,
          runCursor,
          threadInProgress,
          threadsCursor,
        },
      );
      messagesCursor = result.messagesCursor;
      runCursor = result.runCursor;
      threadInProgress = result.threadInProgress;
      threadsCursor = result.threadsCursor;
      isDone = result.isDone;
    }
  },
  returns: v.null(),
});

export const deleteAllForUserIdAsync = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const isDone = await deleteAllForUserIdAsyncHandler(ctx, {
      userId: args.userId,
      messagesCursor: null,
      runCursor: null,
      threadsCursor: null,
      threadInProgress: null,
    });
    return isDone;
  },
  returns: v.boolean(),
});

const deleteAllArgs = {
  userId: v.string(),
  messagesCursor: nullable(v.string()),
  runCursor: v.optional(nullable(v.string())),
  threadsCursor: nullable(v.string()),
  threadInProgress: nullable(v.id("threads")),
};
type DeleteAllArgs = ObjectType<typeof deleteAllArgs>;
const deleteAllReturns = {
  threadsCursor: v.string(),
  threadInProgress: nullable(v.id("threads")),
  messagesCursor: nullable(v.string()),
  runCursor: nullable(v.string()),
  isDone: v.boolean(),
};
type DeleteAllReturns = ObjectType<typeof deleteAllReturns>;

export const _deleteAllForUserIdAsync = internalMutation({
  args: deleteAllArgs,
  handler: deleteAllForUserIdAsyncHandler,
  returns: v.boolean(),
});

async function deleteAllForUserIdAsyncHandler(
  ctx: MutationCtx,
  args: DeleteAllArgs,
): Promise<boolean> {
  const result = await deletePageForUserId(ctx, args);
  if (!result.isDone) {
    await ctx.scheduler.runAfter(0, internal.users._deleteAllForUserIdAsync, {
      userId: args.userId,
      messagesCursor: result.messagesCursor,
      runCursor: result.runCursor,
      threadsCursor: result.threadsCursor,
      threadInProgress: result.threadInProgress,
    });
  }
  return result.isDone;
}

export const _deletePageForUserId = internalMutation({
  args: deleteAllArgs,
  handler: deletePageForUserId,
  returns: deleteAllReturns,
});
async function deletePageForUserId(
  ctx: MutationCtx,
  args: DeleteAllArgs,
): Promise<DeleteAllReturns> {
  let threadInProgress: Id<"threads"> | null = args.threadInProgress;
  let threadsCursor: string | null = args.threadsCursor;
  let messagesCursor: string | null = args.messagesCursor;
  let runCursor: string | null = args.runCursor ?? null;

  // Phase 1: Get a thread to work on if we don't have one
  if (!threadsCursor || !threadInProgress) {
    const threads = await paginator(ctx.db, schema)
      .query("threads")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .paginate({
        numItems: 1,
        cursor: args.threadsCursor ?? null,
      });
    threadsCursor = threads.continueCursor;
    if (threads.page.length > 0) {
      threadInProgress = threads.page[0]._id;
      messagesCursor = null;
      runCursor = null;
    } else {
      return {
        isDone: true,
        threadsCursor,
        threadInProgress,
        messagesCursor,
        runCursor,
      };
    }
  }

  const messages = await paginator(ctx.db, schema)
    .query("messages")
    .withIndex("threadId_status_tool_order_stepOrder", (q) =>
      q.eq("threadId", threadInProgress!),
    )
    .order("desc")
    .paginate({
      numItems: 100,
      cursor: args.messagesCursor,
    });
  await Promise.all(messages.page.map((m) => deleteMessage(ctx, m)));

  if (messages.isDone) {
    messagesCursor = null;
    const runs = await deleteRunsPageForThreadId(ctx, {
      threadId: threadInProgress,
      cursor: runCursor ?? undefined,
    });
    runCursor = runs.isDone ? null : runs.cursor;
    if (runs.isDone) {
      await ctx.db.delete("threads", threadInProgress);
      threadInProgress = null;
    }
  } else {
    messagesCursor = messages.continueCursor;
  }

  return {
    messagesCursor,
    runCursor,
    threadsCursor,
    threadInProgress,
    isDone: false,
  };
}

export const getThreadUserId = internalQuery({
  args: {
    threadId: v.id("threads"),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("threads", args.threadId);
    return thread?.userId ?? null;
  },
});
