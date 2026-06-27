import { internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  createRag,
  retrievalConfigured,
  supportKnowledgeDocs,
  vKnowledgeSeed,
} from "./agent";
import { components } from "../_generated/api";

const rag = createRag(components);

export const getSeed = internalQuery({
  args: { userId: v.string(), version: v.string() },
  returns: v.union(vKnowledgeSeed, v.null()),
  handler: async (ctx, args) => {
    const seed = await ctx.db
      .query("knowledgeSeeds")
      .withIndex("by_user_version", (q) =>
        q.eq("userId", args.userId).eq("version", args.version),
      )
      .unique();
    return seed
      ? {
          userId: seed.userId,
          version: seed.version,
          status: seed.status ?? "ready",
          error: seed.error,
        }
      : null;
  },
});

export const markSeedReady = internalMutation({
  args: { userId: v.string(), version: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seed = await ctx.db
      .query("knowledgeSeeds")
      .withIndex("by_user_version", (q) =>
        q.eq("userId", args.userId).eq("version", args.version),
      )
      .unique();
    if (!seed) return null;
    await ctx.db.patch("knowledgeSeeds", seed._id, {
      status: "ready",
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markSeedFailed = internalMutation({
  args: { userId: v.string(), version: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seed = await ctx.db
      .query("knowledgeSeeds")
      .withIndex("by_user_version", (q) =>
        q.eq("userId", args.userId).eq("version", args.version),
      )
      .unique();
    if (!seed) return null;
    await ctx.db.patch("knowledgeSeeds", seed._id, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const seedSupportKnowledge = internalAction({
  args: { userId: v.string(), version: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!retrievalConfigured()) return null;
    try {
      for (const doc of supportKnowledgeDocs) {
        await rag.add(ctx, {
          namespace: args.userId,
          key: `support:${args.version}:${doc.key}`,
          title: doc.title,
          contentHash: `${args.version}:${doc.text}`,
          text: doc.text,
          filterValues: [{ name: "source", value: "support" }],
          metadata: {
            source: "support",
            key: doc.key,
            title: doc.title,
          },
        });
      }
      await ctx.runMutation(internal.support.knowledge.markSeedReady, {
        userId: args.userId,
        version: args.version,
      });
    } catch (error) {
      await ctx.runMutation(internal.support.knowledge.markSeedFailed, {
        userId: args.userId,
        version: args.version,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  },
});

export const indexUploadedFile = internalAction({
  args: { fileId: v.id("files") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!retrievalConfigured()) return null;
    const file = await ctx.runQuery(internal.support.files.getById, {
      fileId: args.fileId,
    });
    if (!file?.extractedText || file.extractionStatus !== "extracted") {
      return null;
    }
    await rag.add(ctx, {
      namespace: file.userId,
      key: `file:${file._id}`,
      title: file.filename,
      contentHash: `${file.storageId ?? file._id}:${file.size ?? 0}:${file.textLength ?? file.extractedText.length}`,
      text: file.extractedText,
      filterValues: [{ name: "source", value: "file" }],
      metadata: {
        source: "file",
        fileId: file._id,
        filename: file.filename,
        mediaType: file.mediaType,
      },
    });
    return null;
  },
});
