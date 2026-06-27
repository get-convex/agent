import {
  type AgentContextBlock,
} from "@convex-dev/agent";
import { internalMutation, query } from "../_generated/server";
import { v } from "convex/values";
import {
  vContextBlockDoc,
  vSessionId,
} from "./agent";
import {
  caller,
  contextBlocksForRun,
  requireAuthorizedRun,
} from "./shared";

export const list = query({
  args: {
    sessionId: vSessionId,
    runId: v.string(),
  },
  returns: v.array(vContextBlockDoc),
  handler: async (ctx, args) => {
    const current = caller(args);
    await requireAuthorizedRun(ctx, args.runId, current.userId);
    return await contextBlocksForRun(ctx, current.userId, args.runId);
  },
});

export const recordBlocks = internalMutation({
  args: {
    userId: v.string(),
    runId: v.string(),
    source: v.string(),
    blocks: v.array(
      v.object({
        type: v.literal("text"),
        name: v.optional(v.string()),
        text: v.string(),
        metadata: v.optional(v.any()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args: {
    userId: string;
    runId: string;
    source: string;
    blocks: AgentContextBlock[];
  }) => {
    const existing = await ctx.db
      .query("contextBlocks")
      .withIndex("by_user_runId", (q) =>
        q.eq("userId", args.userId).eq("runId", args.runId),
      )
      .collect();
    for (const block of existing) {
      if (block.source === args.source) {
        await ctx.db.delete("contextBlocks", block._id);
      }
    }
    const createdAt = Date.now();
    for (const block of args.blocks) {
      await ctx.db.insert("contextBlocks", {
        userId: args.userId,
        runId: args.runId,
        source: args.source,
        name: block.name,
        text: block.text,
        metadata: block.metadata,
        createdAt,
      });
    }
    return null;
  },
});
