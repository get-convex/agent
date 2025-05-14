import { paginator } from "convex-helpers/server/pagination";
import { nullable } from "convex-helpers/validators";
import { ObjectType } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  action,
  internalMutation,
  mutation,
  MutationCtx,
  query,
} from "./_generated/server.js";
import { schema, v } from "./schema.js";
import { deleteMessage } from "./messages.js";
import { paginationOptsValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { paginationResultValidator } from "../validators.js";

// Note: it only searches for users with threads
export const listUsersWithThreads = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const results = await stream(ctx.db, schema)
      .query("threads")
      .withIndex("userId", (q) => q)
      .filterWith(async (q) => !!q.userId)
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
    let messagesCursor = null;
    let threadsCursor = null;
    let isDone = false;
    while (!isDone) {
      const result: {
        messagesCursor: string;
        threadsCursor: string | null;
        isDone: boolean;
      } = await ctx.runMutation(internal.users._deletePageForUserId, {
        userId: args.userId,
        messagesCursor,
        threadsCursor,
      });
      messagesCursor = result.messagesCursor;
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
      threadsCursor: null,
    });
    return isDone;
  },
  returns: v.boolean(),
});

const deleteAllArgs = {
  userId: v.string(),
  messagesCursor: nullable(v.string()),
  threadsCursor: nullable(v.string()),
};
type DeleteAllArgs = ObjectType<typeof deleteAllArgs>;
const deleteAllReturns = {
  messagesCursor: v.string(),
  threadsCursor: nullable(v.string()),
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
  args: DeleteAllArgs
): Promise<boolean> {
  const result = await deletePageForUserId(ctx, args);
  if (!result.isDone) {
    await ctx.scheduler.runAfter(0, internal.users._deleteAllForUserIdAsync, {
      userId: args.userId,
      messagesCursor: result.messagesCursor,
      threadsCursor: result.threadsCursor,
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
  args: DeleteAllArgs
): Promise<DeleteAllReturns> {
  const threads = await paginator(ctx.db, schema)
    .query("threads")
    .withIndex("userId", (q) => q.eq("userId", args.userId))
    .order("desc")
    .paginate({
      numItems: 100,
      cursor: args.threadsCursor ?? null,
    });
  await Promise.all(threads.page.map((c) => ctx.db.delete(c._id)));
  const messages = await paginator(ctx.db, schema)
    .query("messages")
    .withIndex("userId_status_tool_order_stepOrder", (q) =>
      q.eq("userId", args.userId)
    )
    .order("desc")
    .paginate({
      numItems: 100,
      cursor: args.messagesCursor ?? null,
    });
  await Promise.all(messages.page.map((m) => deleteMessage(ctx, m)));
  return {
    messagesCursor: messages.continueCursor,
    threadsCursor: threads.continueCursor,
    isDone: messages.isDone,
  };
}
