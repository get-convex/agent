import { internalMutation, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import {
  vCaseStatus,
  vSessionId,
  vSupportCase,
} from "./agent";
import {
  caller,
  createCase,
  findActiveCase,
  toSupportCase,
} from "./shared";

export const getActive = query({
  args: { sessionId: vSessionId },
  returns: v.union(vSupportCase, v.null()),
  handler: async (ctx, args) => {
    const current = caller(args);
    const supportCase = await findActiveCase(ctx, current.userId);
    return supportCase ? toSupportCase(supportCase) : null;
  },
});

export const create = mutation({
  args: { sessionId: vSessionId, title: v.optional(v.string()) },
  returns: vSupportCase,
  handler: async (ctx, args) => {
    const current = caller(args);
    const existing = await ctx.db
      .query("cases")
      .withIndex("by_user_active", (q) =>
        q.eq("userId", current.userId).eq("active", true),
      )
      .collect();
    for (const supportCase of existing) {
      await ctx.db.patch("cases", supportCase._id, {
        active: false,
        updatedAt: Date.now(),
      });
    }
    const title = args.title ?? "Support conversation";
    const created = await createCase(ctx, current.userId, title);
    return toSupportCase(created);
  },
});

export const updateForRun = internalMutation({
  args: {
    userId: v.string(),
    threadId: v.string(),
    runId: v.string(),
    status: vCaseStatus,
  },
  returns: v.union(v.id("cases"), v.null()),
  handler: async (ctx, args) => {
    const supportCase = await ctx.db
      .query("cases")
      .withIndex("by_user_threadId", (q) =>
        q.eq("userId", args.userId).eq("threadId", args.threadId),
      )
      .first();
    if (!supportCase) return null;
    await ctx.db.patch("cases", supportCase._id, {
      lastRunId: args.runId,
      status: args.status,
      updatedAt: Date.now(),
    });
    return supportCase._id;
  },
});
