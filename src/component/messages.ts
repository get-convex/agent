import { assert } from "convex-helpers";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { ObjectType } from "convex/values";
import {
  DEFAULT_MESSAGE_RANGE,
  DEFAULT_RECENT_MESSAGES,
  extractText,
  isTool,
} from "../shared.js";
import {
  paginationResultValidator,
  vMessageStatus,
  vMessageWithMetadata,
  vSearchOptions,
  vStepWithMessages,
} from "../validators.js";
import { api, internal } from "./_generated/api.js";
import { Doc, Id } from "./_generated/dataModel.js";
import {
  action,
  internalQuery,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server.js";
import { schema, v } from "./schema.js";
import { insertVector, searchVectors } from "./vector/index.js";
import {
  VectorDimension,
  VectorDimensions,
  VectorTableId,
  vVectorId,
} from "./vector/tables.js";
import { paginationOptsValidator } from "convex/server";

export async function deleteMessage(
  ctx: MutationCtx,
  messageDoc: Doc<"messages">
) {
  await ctx.db.delete(messageDoc._id);
  if (messageDoc.embeddingId) {
    await ctx.db.delete(messageDoc.embeddingId);
  }
  if (messageDoc.fileId) {
    const file = await ctx.db.get(messageDoc.fileId);
    if (file) {
      await ctx.db.patch(messageDoc.fileId, { refcount: file.refcount - 1 });
    }
  }
}

export const vMessageDoc = schema.tables.messages.validator;
export const messageStatuses = vMessageDoc.fields.status.members.map(
  (m) => m.value
);

const addMessagesArgs = {
  userId: v.optional(v.string()),
  threadId: v.id("threads"),
  stepId: v.optional(v.id("steps")),
  parentMessageId: v.optional(v.id("messages")),
  agentName: v.optional(v.string()),
  messages: v.array(vMessageWithMetadata),
  pending: v.optional(v.boolean()),
  failPendingSteps: v.optional(v.boolean()),
};
export const addMessages = mutation({
  args: addMessagesArgs,
  handler: addMessagesHandler,
  returns: v.object({
    messages: v.array(v.doc("messages")),
    pending: v.optional(v.doc("messages")),
  }),
});
async function addMessagesHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof addMessagesArgs>
) {
  let userId = args.userId;
  const threadId = args.threadId;
  if (!userId && args.threadId) {
    const thread = await ctx.db.get(args.threadId);
    assert(thread, `Thread ${args.threadId} not found`);
    userId = thread.userId;
  }
  const { failPendingSteps, pending, messages, parentMessageId, ...rest } =
    args;
  if (failPendingSteps) {
    assert(args.threadId, "threadId is required to fail pending steps");
    const pendingMessages = await ctx.db
      .query("messages")
      .withIndex("threadId_status_tool_order_stepOrder", (q) =>
        q.eq("threadId", threadId).eq("status", "pending")
      )
      .collect();
    await Promise.all(
      pendingMessages.map((m) =>
        ctx.db.patch(m._id, { status: "failed", error: "Restarting" })
      )
    );
  }
  const maxMessage = await getMaxMessage(ctx, threadId, userId);
  let order = maxMessage?.order ?? -1;
  const toReturn: Doc<"messages">[] = [];
  if (messages.length > 0) {
    for (const { message, fileId, embedding, ...fields } of messages) {
      let embeddingId: VectorTableId | undefined;
      if (embedding) {
        embeddingId = await insertVector(ctx, embedding.dimension, {
          vector: embedding.vector,
          model: embedding.model,
          table: "messages",
          userId,
          threadId,
        });
      }
      const tool = isTool(message);
      if (!tool) {
        order++;
      }
      const text = extractText(message);
      const messageId = await ctx.db.insert("messages", {
        ...rest,
        ...fields,
        embeddingId,
        parentMessageId,
        userId,
        message,
        order,
        tool,
        text,
        fileId,
        status: pending ? "pending" : "success",
        stepOrder: 0,
      });
      if (fileId) {
        await ctx.db.patch(fileId, {
          refcount: (await ctx.db.get(fileId))!.refcount + 1,
        });
      }
      toReturn.push((await ctx.db.get(messageId))!);
    }
  }
  return { messages: toReturn };
}

async function getMaxMessage(
  ctx: QueryCtx,
  threadId: Id<"threads"> | undefined,
  userId: string | undefined
) {
  assert(threadId || userId, "One of threadId or userId is required");
  if (threadId) {
    return mergedStream(
      ["success" as const, "pending" as const].map((status) =>
        stream(ctx.db, schema)
          .query("messages")
          .withIndex("threadId_status_tool_order_stepOrder", (q) =>
            q.eq("threadId", threadId).eq("status", status).eq("tool", false)
          )
          .order("desc")
      ),
      ["order", "stepOrder"]
    ).first();
  } else {
    // DO explicitly
    const maxPending = await ctx.db
      .query("messages")
      .withIndex("userId_status_tool_order_stepOrder", (q) =>
        q.eq("userId", userId).eq("status", "pending").eq("tool", false)
      )
      .order("desc")
      .first();
    const maxSuccess = await ctx.db
      .query("messages")
      .withIndex("userId_status_tool_order_stepOrder", (q) =>
        q.eq("userId", userId).eq("status", "success").eq("tool", false)
      )
      .order("desc")
      .first();
    return maxPending
      ? maxSuccess
        ? maxPending.order > maxSuccess.order
          ? maxPending
          : maxSuccess
        : maxPending
      : maxSuccess ?? null;
  }
}

const addStepArgs = {
  userId: v.optional(v.string()),
  threadId: v.id("threads"),
  parentMessageId: v.id("messages"),
  step: vStepWithMessages,
  failPendingSteps: v.optional(v.boolean()),
};

export const addStep = mutation({
  args: addStepArgs,
  returns: v.array(v.doc("steps")),
  handler: addStepHandler,
});
async function addStepHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof addStepArgs>
) {
  const parentMessage = await ctx.db.get(args.parentMessageId);
  assert(parentMessage, `Message ${args.parentMessageId} not found`);
  const order = parentMessage.order;
  assert(order !== undefined, `${args.parentMessageId} has no order`);
  let steps = await ctx.db
    .query("steps")
    .withIndex("parentMessageId_order_stepOrder", (q) =>
      // TODO: fetch pending, and commit later
      q.eq("parentMessageId", args.parentMessageId)
    )
    .collect();
  if (args.failPendingSteps) {
    for (const step of steps) {
      if (step.status === "pending") {
        await ctx.db.patch(step._id, { status: "failed" });
      }
    }
    steps = steps.filter((s) => s.status !== "failed");
  }
  const { step, messages } = args.step;
  const stepId = await ctx.db.insert("steps", {
    threadId: args.threadId,
    parentMessageId: args.parentMessageId,
    order,
    stepOrder: (steps.at(-1)?.stepOrder ?? -1) + 1,
    status: step.finishReason === "stop" ? "success" : "pending",
    step,
  });
  await addMessagesHandler(ctx, {
    userId: args.userId,
    threadId: args.threadId,
    stepId,
    parentMessageId: args.parentMessageId,
    agentName: parentMessage.agentName,
    messages,
    pending: step.finishReason === "stop" ? false : true,
    failPendingSteps: false,
  });
  // We don't commit if the parent is still pending.
  if (step.finishReason === "stop") {
    await commitMessageHandler(ctx, { messageId: args.parentMessageId });
  }
  steps.push((await ctx.db.get(stepId))!);
  return steps;
}

export const rollbackMessage = mutation({
  args: {
    messageId: v.id("messages"),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, error }) => {
    const message = await ctx.db.get(messageId);
    assert(message, `Message ${messageId} not found`);
    // TODO: do BFS to fail all associated messages, then steps
    // with parentMessageId of those messages, etc.
    const steps = await ctx.db
      .query("steps")
      .withIndex("parentMessageId_order_stepOrder", (q) =>
        // TODO: fetch pending, and commit later
        q.eq("parentMessageId", messageId)
      )
      .collect();
    for (const step of steps) {
      if (step.status === "pending") {
        await ctx.db.patch(step._id, { status: "failed" });
      }
    }
    await ctx.db.patch(messageId, {
      status: "failed",
      error: error,
    });
  },
});

export const commitMessage = mutation({
  args: {
    messageId: v.id("messages"),
  },
  returns: v.null(),
  handler: commitMessageHandler,
});
async function commitMessageHandler(
  ctx: MutationCtx,
  { messageId }: { messageId: Id<"messages"> }
) {
  const message = await ctx.db.get(messageId);
  assert(message, `Message ${messageId} not found`);

  const allSteps = await ctx.db
    .query("steps")
    .withIndex("parentMessageId_order_stepOrder", (q) =>
      q.eq("parentMessageId", messageId)
    )
    .collect();
  for (const step of allSteps) {
    if (step.status === "pending") {
      await ctx.db.patch(step._id, { status: "success" });
    }
  }
  const order = message.order!;
  const messages = await mergedStream(
    [true, false].map((tool) =>
      stream(ctx.db, schema)
        .query("messages")
        .withIndex("threadId_status_tool_order_stepOrder", (q) =>
          q
            .eq("threadId", message.threadId)
            .eq("status", "pending")
            .eq("tool", tool)
            .eq("order", order)
        )
    ),
    ["order", "stepOrder"]
  ).collect();
  for (const message of messages) {
    await ctx.db.patch(message._id, { status: "success" });
    // TODO: recursively commit steps & messages that might depend on this one.
  }
}

export const getThreadMessages = query({
  args: {
    threadId: v.id("threads"),
    isTool: v.optional(v.boolean()),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    paginationOpts: v.optional(paginationOptsValidator),
    statuses: v.optional(v.array(vMessageStatus)),
    beforeMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const statuses =
      args.statuses ?? vMessageStatus.members.map((m) => m.value);
    const before =
      args.beforeMessageId && (await ctx.db.get(args.beforeMessageId));
    const toolOptions =
      args.isTool === undefined ? [true, false] : [args.isTool];
    const order = args.order ?? "desc";
    const streams = toolOptions.flatMap((tool) =>
      statuses.map((status) =>
        stream(ctx.db, schema)
          .query("messages")
          .withIndex("threadId_status_tool_order_stepOrder", (q) => {
            const qq = q
              .eq("threadId", args.threadId)
              .eq("status", status)
              .eq("tool", tool);
            if (before) {
              return qq.lte("order", before.order);
            }
            return qq;
          })
          .order(order)
      )
    );
    const messages = await mergedStream(streams, [
      "order",
      "stepOrder",
    ]).paginate(
      args.paginationOpts ?? {
        numItems: DEFAULT_RECENT_MESSAGES,
        cursor: null,
      }
    );
    return messages;
  },
  returns: paginationResultValidator(v.doc("messages")),
});

export const searchMessages = action({
  args: {
    userId: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    beforeMessageId: v.optional(v.id("messages")),
    ...vSearchOptions.fields,
  },
  returns: v.array(v.doc("messages")),
  handler: async (ctx, args): Promise<Doc<"messages">[]> => {
    assert(args.userId || args.threadId, "Specify userId or threadId");
    const limit = args.limit;
    let textSearchMessages: Doc<"messages">[] | undefined;
    if (args.text) {
      textSearchMessages = await ctx.runQuery(api.messages.textSearch, {
        userId: args.userId,
        threadId: args.threadId,
        text: args.text,
        limit,
      });
    }
    if (args.vector) {
      const dimension = args.vector.length as VectorDimension;
      if (!VectorDimensions.includes(dimension)) {
        throw new Error(`Unsupported vector dimension: ${dimension}`);
      }
      const vectors = (
        await searchVectors(ctx, args.vector, {
          dimension,
          model: args.vectorModel ?? "unknown",
          table: "messages",
          userId: args.userId,
          threadId: args.threadId,
          limit,
        })
      ).filter((v) => v._score > (args.vectorScoreThreshold ?? 0));
      // Reciprocal rank fusion
      const k = 10;
      const textEmbeddingIds = textSearchMessages?.map((m) => m.embeddingId);
      const vectorScores = vectors
        .map((v, i) => ({
          id: v._id,
          score:
            1 / (i + k) +
            1 / ((textEmbeddingIds?.indexOf(v._id) ?? Infinity) + k),
        }))
        .sort((a, b) => b.score - a.score);
      const vectorIds = vectorScores.slice(0, limit).map((v) => v.id);
      const messages: Doc<"messages">[] = await ctx.runQuery(
        internal.messages._fetchSearchMessages,
        {
          userId: args.userId,
          threadId: args.threadId,
          vectorIds,
          textSearchMessages: textSearchMessages?.filter(
            (m) => !vectorIds.includes(m.embeddingId!)
          ),
          messageRange: args.messageRange ?? DEFAULT_MESSAGE_RANGE,
          beforeMessageId: args.beforeMessageId,
          limit,
        }
      );
      return messages;
    }
    return textSearchMessages?.flat() ?? [];
  },
});

export const _fetchSearchMessages = internalQuery({
  args: {
    userId: v.optional(v.string()),
    threadId: v.optional(v.id("threads")),
    vectorIds: v.array(vVectorId),
    textSearchMessages: v.optional(v.array(v.doc("messages"))),
    messageRange: v.object({ before: v.number(), after: v.number() }),
    beforeMessageId: v.optional(v.id("messages")),
    limit: v.number(),
  },
  returns: v.array(v.doc("messages")),
  handler: async (ctx, args): Promise<Doc<"messages">[]> => {
    const beforeMessage =
      args.beforeMessageId && (await ctx.db.get(args.beforeMessageId));
    const { userId, threadId } = args;
    assert(userId || threadId, "Specify userId or threadId to search");
    let messages = (
      await Promise.all(
        args.vectorIds.map((embeddingId) =>
          ctx.db
            .query("messages")
            .withIndex("embeddingId", (q) => q.eq("embeddingId", embeddingId))
            .filter((q) =>
              userId
                ? q.eq(q.field("userId"), userId)
                : q.eq(q.field("threadId"), threadId)
            )
            // Don't include pending. Failed messages hopefully are deleted but may as well be safe.
            .filter((q) => q.eq(q.field("status"), "success"))
            .first()
        )
      )
    ).filter(
      (m): m is Doc<"messages"> =>
        m !== undefined &&
        m !== null &&
        !m.tool &&
        (!beforeMessage || m.order <= beforeMessage.order)
    );
    messages.push(...(args.textSearchMessages ?? []));
    // TODO: prioritize more recent messages
    messages.sort((a, b) => a.order! - b.order!);
    messages = messages.slice(0, args.limit);
    // Fetch the surrounding messages
    if (!threadId) {
      return messages.sort((a, b) => a.order - b.order);
    }
    const included: Record<string, Set<number>> = {};
    for (const m of messages) {
      const searchId = m.threadId ?? m.userId!;
      if (!included[searchId]) {
        included[searchId] = new Set();
      }
      included[searchId].add(m.order!);
    }
    const ranges: Record<string, Doc<"messages">[]> = {};
    const { before, after } = args.messageRange;
    for (const m of messages) {
      const searchId = m.threadId ?? m.userId!;
      const order = m.order!;
      let earliest = order - before;
      let latest = order + after;
      for (; earliest <= latest; earliest++) {
        if (!included[searchId].has(earliest)) {
          break;
        }
      }
      for (; latest >= earliest; latest--) {
        if (!included[searchId].has(latest)) {
          break;
        }
      }
      for (let i = earliest; i <= latest; i++) {
        included[searchId].add(i);
      }
      if (earliest !== latest) {
        if (m.threadId) {
          const surrounding = await ctx.db
            .query("messages")
            .withIndex("threadId_status_tool_order_stepOrder", (q) =>
              q
                .eq("threadId", m.threadId)
                .eq("status", "success")
                .eq("tool", false)
                .gte("order", earliest)
                .lte("order", latest)
            )
            .collect();
          if (!ranges[searchId]) {
            ranges[searchId] = [];
          }
          ranges[searchId].push(...surrounding);
        } else {
          const surrounding = await ctx.db
            .query("messages")
            .withIndex("userId_status_tool_order_stepOrder", (q) =>
              q
                .eq("userId", m.userId!)
                .eq("status", "success")
                .eq("tool", false)
                .gte("order", earliest)
                .lte("order", latest)
            )
            .collect();
          if (!ranges[searchId]) {
            ranges[searchId] = [];
          }
          ranges[searchId].push(...surrounding);
        }
      }
    }
    for (const r of Object.values(ranges).flat()) {
      if (!messages.some((m) => m._id === r._id)) {
        messages.push(r);
      }
    }
    return messages.sort((a, b) => a.order - b.order);
  },
});

// returns ranges of messages in order of text search relevance,
// excluding duplicates in later ranges.
export const textSearch = query({
  args: {
    threadId: v.optional(v.id("threads")),
    userId: v.optional(v.string()),
    text: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assert(args.userId || args.threadId, "Specify userId or threadId");
    const messages = await ctx.db
      .query("messages")
      .withSearchIndex("text_search", (q) =>
        args.userId
          ? q.search("text", args.text).eq("userId", args.userId)
          : q.search("text", args.text).eq("threadId", args.threadId!)
      )
      // Just in case tool messages slip through
      .filter((q) => q.eq(q.field("tool"), false))
      .take(args.limit);
    return messages;
  },
  returns: v.array(v.doc("messages")),
});
