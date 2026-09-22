import { paginator } from "convex-helpers/server/pagination";
import type { Doc, Id } from "./_generated/dataModel.js";
import { mutation, type MutationCtx, query } from "./_generated/server.js";
import { schema, v } from "./schema.js";
import { paginationOptsValidator } from "convex/server";
import type { Infer } from "convex/values";

const FILE_CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;

const addFileArgs = v.object({
  userId: v.optional(v.string()),
  storageId: v.string(),
  hash: v.string(),
  filename: v.optional(v.string()),
  mediaType: v.optional(v.string()),
  /** @deprecated Use `mediaType` instead. */
  mimeType: v.optional(v.string()),
});

export const addFile = mutation({
  args: addFileArgs,
  handler: addFileHandler,
  returns: {
    fileId: v.id("files"),
    storageId: v.string(),
  },
});

export async function addFileHandler(
  ctx: MutationCtx,
  args: Infer<typeof addFileArgs>,
) {
  // Support both mediaType (preferred) and mimeType (deprecated)
  const mediaType = normalizeMediaType(args.mediaType ?? args.mimeType);

  const existingFile = await findExistingFile(ctx, { ...args, mediaType });
  if (existingFile) {
    // Registration does not retain the file. Persisted messages and in-flight
    // streams acquire retention references explicitly.
    await ctx.db.patch("files", existingFile._id, {
      lastTouchedAt: Date.now(),
    });
    return {
      fileId: existingFile._id,
      storageId: existingFile.storageId,
    };
  }
  const fileId = await ctx.db.insert("files", {
    userId: args.userId,
    storageId: args.storageId,
    hash: args.hash,
    filename: args.filename,
    mediaType,
    mimeType: args.mimeType, // Keep for backwards compatibility
    // We start out with it unused - when it's saved in a message we increment.
    refcount: 0,
    lastTouchedAt: Date.now(),
  });
  return {
    fileId,
    storageId: args.storageId,
  };
}

export const get = query({
  args: {
    fileId: v.id("files"),
    // The parent app authenticates the caller before supplying this identifier.
    requireUserId: v.optional(v.string()),
  },
  returns: v.union(v.null(), v.doc("files")),
  handler: async (ctx, args) => {
    const file = await ctx.db.get("files", args.fileId);
    if (
      args.requireUserId !== undefined &&
      file?.userId !== args.requireUserId
    ) {
      return null;
    }
    return file;
  },
});

/**
 * If you plan to have the same file added over and over without a reference to
 * the fileId, you can use this query to get the fileId of the existing file.
 * This does not increment refcount; messages and streams retain files explicitly.
 * It will only match within the same user scope and filename (including unset).
 */
export const useExistingFile = mutation({
  args: {
    userId: v.optional(v.string()),
    hash: v.string(),
    filename: v.optional(v.string()),
    mediaType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const file = await findExistingFile(ctx, args);
    if (!file) {
      return null;
    }
    await ctx.db.patch("files", file._id, {
      lastTouchedAt: Date.now(),
    });
    return { fileId: file._id, storageId: file.storageId };
  },
  returns: v.union(
    v.null(),
    v.object({
      fileId: v.id("files"),
      storageId: v.string(),
    }),
  ),
});

async function findExistingFile(
  ctx: MutationCtx,
  args: {
    userId?: string;
    hash: string;
    filename?: string;
    mediaType?: string;
  },
) {
  const expected = normalizeMediaType(args.mediaType);
  const candidates = ctx.db
    .query("files")
    .withIndex("userId_hash_filename", (q) =>
      q
        .eq("userId", args.userId)
        .eq("hash", args.hash)
        .eq("filename", args.filename),
    );
  for await (const candidate of candidates) {
    if (sameMediaType(candidate, expected)) return candidate;
  }
  return null;
}

function normalizeMediaType(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function sameMediaType(
  file: Pick<Doc<"files">, "mediaType" | "mimeType">,
  expected: string | undefined,
) {
  const actual = normalizeMediaType(file.mediaType ?? file.mimeType);
  // File rows from before media-type tracking have no value to distinguish.
  // Preserve the prior hash-and-filename reuse behavior for those rows.
  return expected === undefined || actual === undefined || actual === expected;
}

/** Transfer retention references between two durable records. */
export async function changeRefcount(
  ctx: MutationCtx,
  previous: Id<"files">[],
  next: Id<"files">[],
) {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  for (const fileId of new Set([...previousSet, ...nextSet])) {
    const increment = Number(!previousSet.has(fileId) && nextSet.has(fileId));
    const decrement = Number(previousSet.has(fileId) && !nextSet.has(fileId));
    if (increment === 0 && decrement === 0) continue;
    const file = await ctx.db.get("files", fileId);
    if (!file) {
      if (increment === 0) {
        console.error(`File ${fileId} not found when decrementing refcount`);
        continue;
      }
      throw new Error(`File ${fileId} not found when incrementing refcount`);
    }
    if (file.refcount < decrement) {
      throw new Error(
        `File ${fileId} refcount underflow: ${file.refcount} - ${decrement}`,
      );
    }
    const delta = increment - decrement;
    await ctx.db.patch("files", fileId, {
      refcount: file.refcount + delta,
      lastTouchedAt: Date.now(),
    });
  }
}

export const copyFile = mutation({
  args: {
    fileId: v.id("files"),
  },
  handler: copyFileHandler,
  returns: v.null(),
});

export async function copyFileHandler(
  ctx: MutationCtx,
  args: { fileId: Id<"files"> },
) {
  await changeRefcount(ctx, [], [args.fileId]);
}

/**
 * Get files that are unused and can be deleted.
 * This is useful for cleaning up files that are no longer needed.
 * Files remain protected for 24 hours after registration or their last
 * reference change, so a file cannot be removed between registration and the
 * transaction that saves its message or stream reference.
 */
export const getFilesToDelete = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const files = await paginator(ctx.db, schema)
      .query("files")
      .withIndex("refcount_lastTouchedAt", (q) =>
        q
          .eq("refcount", 0)
          .lte("lastTouchedAt", Date.now() - FILE_CLEANUP_GRACE_MS),
      )
      .paginate(args.paginationOpts);
    return files;
  },
  returns: v.object({
    page: v.array(v.doc("files")),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
});

const deleteFilesArgs = {
  fileIds: v.array(v.id("files")),
  force: v.optional(v.boolean()),
};

/** Delete file records. Use deleteFilesWithStorageIds when also deleting blobs. */
export const deleteFiles = mutation({
  args: deleteFilesArgs,
  returns: v.array(v.id("files")),
  handler: async (ctx, args) => {
    const deleted = await deleteFileRecords(ctx, args);
    return deleted.map((file) => file._id);
  },
});

/**
 * Delete eligible records and return blobs with no remaining file references.
 * Call from a parent-app mutation and delete the returned storage IDs in that
 * same mutation, so record and blob deletion commit or roll back together.
 * This is a trusted maintenance operation, not an end-user deletion API.
 */
export const deleteFilesWithStorageIds = mutation({
  args: deleteFilesArgs,
  returns: v.object({
    deletedFileIds: v.array(v.id("files")),
    storageIdsToDelete: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const deleted = await deleteFileRecords(ctx, args);
    const storageIdsToDelete: string[] = [];
    for (const storageId of new Set(deleted.map((file) => file.storageId))) {
      const remaining = await ctx.db
        .query("files")
        .withIndex("storageId", (q) => q.eq("storageId", storageId))
        .first();
      if (!remaining) storageIdsToDelete.push(storageId);
    }
    return {
      deletedFileIds: deleted.map((file) => file._id),
      storageIdsToDelete,
    };
  },
});

async function deleteFileRecords(
  ctx: MutationCtx,
  args: { fileIds: Id<"files">[]; force?: boolean },
) {
  const deleted: Doc<"files">[] = [];
  for (const fileId of new Set(args.fileIds)) {
    const file = await ctx.db.get("files", fileId);
    if (!file) {
      console.error(`File ${fileId} not found when deleting, skipping...`);
      continue;
    }
    if (!args.force && file.refcount > 0) {
      console.error(
        `File ${fileId} has refcount ${file.refcount} > 0, skipping...`,
      );
      continue;
    }
    if (
      !args.force &&
      file.lastTouchedAt > Date.now() - FILE_CLEANUP_GRACE_MS
    ) {
      console.error(
        `File ${fileId} is still within the cleanup grace period, skipping...`,
      );
      continue;
    }
    await ctx.db.delete("files", fileId);
    deleted.push(file);
  }
  return deleted;
}
