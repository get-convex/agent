import { paginator } from "convex-helpers/server/pagination";
import { mutation, MutationCtx, query } from "./_generated/server.js";
import { schema, v } from "./schema.js";
import { Id } from "./_generated/dataModel.js";

export const addFile = mutation({
  args: {
    storageId: v.string(),
    hash: v.string(),
  },
  handler: addFileHandler,
  returns: v.id("files"),
});

export async function addFileHandler(
  ctx: MutationCtx,
  args: { storageId: string; hash: string }
) {
  const fileId = await ctx.db.insert("files", {
    storageId: args.storageId,
    hash: args.hash,
    refcount: 1,
  });
  return fileId;
}

export const resuseFile = mutation({
  args: {
    fileId: v.id("files"),
  },
  handler: reuseFileHandler,
  returns: v.null(),
});

export async function reuseFileHandler(
  ctx: MutationCtx,
  args: { fileId: Id<"files"> }
) {
  const file = await ctx.db.get(args.fileId);
  if (!file) {
    throw new Error("File not found");
  }
  await ctx.db.patch(args.fileId, {
    refcount: file.refcount + 1,
  });
}

export const getFilesToDelete = query({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const files = await paginator(ctx.db, schema)
      .query("files")
      .withIndex("refcount", (q) => q.eq("refcount", 0))
      .paginate({
        numItems: args.limit ?? 100,
        cursor: args.cursor ?? null,
      });
    return {
      files: files.page,
      continueCursor: files.continueCursor,
      isDone: files.isDone,
    };
  },
  returns: v.object({
    files: v.array(v.doc("files")),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
});
