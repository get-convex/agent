import { paginator } from "convex-helpers/server/pagination";
import { v } from "convex/values";
import { ActionCtx, mutation, MutationCtx, query } from "../_generated/server";
import {
  EmbeddingsWithoutDenormalizedFields,
  getVectorTableName,
  VectorDimension,
  vEmbeddingsWithoutDenormalizedFields,
  vVectorDimension,
  vVectorId,
} from "./tables";
import schema from "../schema";
import { mergedStream } from "convex-helpers/server/stream";
import { stream } from "convex-helpers/server/stream";

export const paginate = query({
  args: {
    vectorDimension: vVectorDimension,
    targetModel: v.string(),
    table: v.optional(v.string()),
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  returns: v.object({
    ids: v.array(vVectorId),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const tableName = getVectorTableName(args.vectorDimension);
    const vectors = await paginator(ctx.db, schema)
      .query(tableName)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .withIndex("model_table_threadId" as any, (q) =>
        args.table
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (q.eq("model", args.targetModel) as any).eq("table", args.table)
          : q.eq("model", args.targetModel)
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: args.limit,
        maximumRowsRead: 300,
      });
    return {
      ids: vectors.page.map((v) => v._id),
      isDone: vectors.isDone,
      continueCursor: vectors.continueCursor,
    };
  },
});

export const deleteBatchForThread = mutation({
  args: {
    vectorDimension: vVectorDimension,
    model: v.string(),
    threadId: v.string(),
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  returns: v.object({
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const tableName = getVectorTableName(args.vectorDimension);
    const vectors = await mergedStream(
      ["thread", "memory"].map((table) =>
        stream(ctx.db, schema)
          .query(tableName)
          .withIndex("model_table_threadId", (q) =>
            q
              .eq("model", args.model)
              .eq("table", table)
              .eq("threadId", args.threadId)
          )
      ),
      ["threadId"]
    ).paginate({
      cursor: args.cursor ?? null,
      numItems: args.limit,
      maximumRowsRead: 300,
    });
    await Promise.all(vectors.page.map((v) => ctx.db.delete(v._id)));
    return {
      isDone: vectors.isDone,
      continueCursor: vectors.continueCursor,
    };
  },
});

export const insertBatch = mutation({
  args: {
    vectorDimension: vVectorDimension,
    vectors: v.array(vEmbeddingsWithoutDenormalizedFields),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Promise.all(
      args.vectors.map((v) => insertVector(ctx, args.vectorDimension, v))
    );
  },
});

export async function insertVector(
  ctx: MutationCtx,
  dimension: VectorDimension,
  v: EmbeddingsWithoutDenormalizedFields
) {
  return ctx.db.insert(getVectorTableName(dimension), {
    ...v,
    model_table_userId: v.userId ? [v.model, v.table, v.userId] : undefined,
    model_table_threadId: v.threadId
      ? [v.model, v.table, v.threadId]
      : undefined,
  });
}

export function searchVectors(
  ctx: ActionCtx,
  vector: number[],
  args: {
    dimension: VectorDimension;
    model: string;
    table: string;
    userId?: string;
    threadId?: string;
    limit?: number;
  }
) {
  const tableName = getVectorTableName(args.dimension);
  return ctx.vectorSearch(tableName, "vector", {
    vector,
    // TODO: to support more tables, add more "OR" clauses for each.
    filter: (q) =>
      args.userId
        ? q.eq("model_table_userId", [args.model, args.table, args.userId])
        : q.eq("model_table_threadId", [
            args.model,
            args.table,
            args.threadId!,
          ]),
    limit: args.limit,
  });
}

export const updateBatch = mutation({
  args: {
    vectors: v.array(
      v.object({
        model: v.string(),
        id: vVectorId,
        vector: v.array(v.number()),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Promise.all(
      args.vectors.map((v) =>
        ctx.db.patch(v.id, {
          model: v.model,
          vector: v.vector,
        })
      )
    );
  },
});

export const deleteBatch = mutation({
  args: {
    ids: v.array(vVectorId),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await Promise.all(args.ids.map((id) => ctx.db.delete(id)));
  },
});
