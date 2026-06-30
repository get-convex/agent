import { internalQuery, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import {
  vFile,
  vSessionId,
} from "./agent";
import {
  caller,
  summaryForUploadedFile,
} from "./shared";
import { internal } from "../_generated/api";

export const generateUploadUrl = mutation({
  args: { sessionId: vSessionId },
  returns: v.string(),
  handler: async (ctx, args) => {
    caller(args);
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveUploaded = mutation({
  args: {
    sessionId: vSessionId,
    storageId: v.id("_storage"),
    filename: v.string(),
    mediaType: v.string(),
    size: v.number(),
    extractedText: v.optional(v.string()),
    extractionStatus: v.optional(
      v.union(
        v.literal("extracted"),
        v.literal("metadataOnly"),
        v.literal("failed"),
      ),
    ),
    textLength: v.optional(v.number()),
    truncated: v.optional(v.boolean()),
    summary: v.optional(v.string()),
  },
  returns: v.id("files"),
  handler: async (ctx, args) => {
    const current = caller(args);
    const url = (await ctx.storage.getUrl(args.storageId)) ?? undefined;
    const extractionStatus =
      args.extractionStatus ??
      (args.extractedText ? ("extracted" as const) : ("metadataOnly" as const));
    const textLength = args.textLength ?? args.extractedText?.length;
    const fileId = await ctx.db.insert("files", {
      userId: current.userId,
      filename: args.filename,
      mediaType: args.mediaType || "application/octet-stream",
      summary: summaryForUploadedFile({
        extractionStatus,
        filename: args.filename,
        size: args.size,
        textLength,
        summary: args.summary,
      }),
      extractedText: args.extractedText,
      extractionStatus,
      textLength,
      truncated: args.truncated,
      url,
      storageId: args.storageId,
      size: args.size,
      createdAt: Date.now(),
    });
    if (extractionStatus === "extracted" && args.extractedText) {
      await ctx.scheduler.runAfter(0, internal.support.knowledge.indexUploadedFile, {
        fileId,
      });
    }
    return fileId;
  },
});

export const list = query({
  args: { sessionId: vSessionId },
  returns: v.array(vFile),
  handler: async (ctx, args) => {
    const current = caller(args);
    return await ctx.db
      .query("files")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", current.userId))
      .order("desc")
      .take(20);
  },
});

export const get = internalQuery({
  args: { fileId: v.id("files"), userId: v.string() },
  returns: v.union(vFile, v.null()),
  handler: async (ctx, args) => {
    const file = await ctx.db.get("files", args.fileId);
    return file && file.userId === args.userId ? file : null;
  },
});

export const getById = internalQuery({
  args: { fileId: v.id("files") },
  returns: v.union(vFile, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("files", args.fileId);
  },
});
