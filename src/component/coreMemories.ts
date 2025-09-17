import { assert } from "convex-helpers";
import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";

export const get = query({
  args: {
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.query("coreMemories").withIndex("userId", (q) => q.eq("userId", args.userId)).first();
  },
});

export const create = mutation({
  args: {
    userId: v.optional(v.string()),
    persona: v.optional(v.string()),
    human: v.optional(v.string()),
  },
  returns: v.id("coreMemories"),
  handler: async (ctx, args) => {
    const doc: Doc<"coreMemories"> | null = await ctx.db
      .query("coreMemories")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .first();
    if (doc) {
      assert(doc.userId === args.userId, `Core memory for user ${args.userId} already exists`);
      return doc._id;
    }
    return ctx.db.insert("coreMemories", args);
  },
});

export const update = mutation({
  args: {
    userId: v.optional(v.string()),
    persona: v.optional(v.union(v.string(), v.null())),
    human: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("coreMemories")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .first();
    assert(doc, `Core memory for user ${args.userId} not found`);
    await ctx.db.patch(doc._id, {
      ...(args.persona !== undefined ? { persona: args.persona ?? undefined } : {}),
      ...(args.human !== undefined ? { human: args.human ?? undefined } : {}),
    });
    return null;
  },
});

export const append = mutation({
  args: {
    userId: v.optional(v.string()),
    field: v.union(v.literal("persona"), v.literal("human")),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("coreMemories")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .first();
    assert(doc, `Core memory for user ${args.userId} not found`);
    const base = (doc[args.field] as string | undefined) ?? "";
    await ctx.db.patch(doc._id, { [args.field]: base + args.text });
    return null;
  },
});

export const prepend = mutation({
  args: {
    userId: v.optional(v.string()),
    field: v.union(v.literal("persona"), v.literal("human")),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("coreMemories")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .first();
    assert(doc, `Core memory for user ${args.userId} not found`);
    const base = (doc[args.field] as string | undefined) ?? "";
    await ctx.db.patch(doc._id, { [args.field]: args.text + base });
    return null;
  },
});

export const insert = mutation({
  args: {
    userId: v.optional(v.string()),
    field: v.union(v.literal("persona"), v.literal("human")),
    index: v.number(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("coreMemories")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .first();
    assert(doc, `Core memory for user ${args.userId} not found`);
    const base = (doc[args.field] as string | undefined) ?? "";
    const i = Math.max(0, Math.min(base.length, Math.floor(args.index)));
    const updated = base.slice(0, i) + args.text + base.slice(i);
    await ctx.db.patch(doc._id, { [args.field]: updated });
    return null;
  },
});

export const remove = mutation({
  args: {
    userId: v.optional(v.string()),
    field: v.union(v.literal("persona"), v.literal("human")),
    index: v.number(),
    length: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("coreMemories")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .first();
    assert(doc, `Core memory for user ${args.userId} not found`);
    const base = (doc[args.field] as string | undefined) ?? "";
    const start = Math.max(0, Math.min(base.length, Math.floor(args.index)));
    const len = Math.max(0, Math.floor(args.length));
    const end = Math.max(start, Math.min(base.length, start + len));
    const updated = base.slice(0, start) + base.slice(end);
    await ctx.db.patch(doc._id, { [args.field]: updated });
    return null;
  },
});
