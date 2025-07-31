import { assert, omit } from "convex-helpers";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { paginationOptsValidator } from "convex/server";
import type { ObjectType } from "convex/values";
import {
  DEFAULT_MESSAGE_RANGE,
  DEFAULT_RECENT_MESSAGES,
  extractText,
  isTool,
} from "../shared.js";
import {
  vMessageEmbeddings,
  vMessageStatus,
  vMessageWithMetadataInternal,
  vPaginationResult,
} from "../validators.js";
import { api, internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  action,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server.js";
import type { MessageDoc } from "./schema.js";
import { schema, v, vMessageDoc } from "./schema.js";
import {
  getThread as _getThread,
  listThreadsByUserId as _listThreadsByUserId,
  updateThread as _updateThread,
} from "./threads.js";
import { insertVector, searchVectors } from "./vector/index.js";
import {
  type VectorDimension,
  VectorDimensions,
  type VectorTableId,
  vVectorId,
} from "./vector/tables.js";
import { changeRefcount } from "./files.js";

function publicMessage(message: Doc<"messages">): MessageDoc {
  return omit(message, ["parentMessageId", "stepId", "files"]);
}

export async function deleteMessage(
  ctx: MutationCtx,
  messageDoc: Doc<"messages">,
) {
  await ctx.db.delete(messageDoc._id);
  if (messageDoc.embeddingId) {
    await ctx.db.delete(messageDoc.embeddingId);
  }
  if (messageDoc.fileIds) {
    await changeRefcount(ctx, messageDoc.fileIds, []);
  }
}

export const deleteByIds = mutation({
  args: {
    messageIds: v.array(v.id("messages")),
  },
  returns: v.array(v.id("messages")),
  handler: async (ctx, args) => {
    const deletedMessageIds = await Promise.all(
      args.messageIds.map(async (id) => {
        const message = await ctx.db.get(id);
        if (message) {
          await deleteMessage(ctx, message);
          return id;
        }
        return null;
      }),
    );
    return deletedMessageIds.filter((id) => id !== null);
  },
});

export const messageStatuses = vMessageDoc.fields.status.members.map(
  (m) => m.value,
);

export const deleteByOrder = mutation({
  args: {
    threadId: v.id("threads"),
    startOrder: v.number(),
    startStepOrder: v.optional(v.number()),
    endOrder: v.number(),
    endStepOrder: v.optional(v.number()),
  },
  returns: v.object({
    isDone: v.boolean(),
    lastOrder: v.optional(v.number()),
    lastStepOrder: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const messages = await orderedMessagesStream(
      ctx,
      args.threadId,
      "asc",
      args.startOrder,
    )
      .narrow({
        lowerBound: args.startStepOrder
          ? [args.startOrder, args.startStepOrder]
          : [args.startOrder],
        lowerBoundInclusive: true,
        upperBound: args.endStepOrder
          ? [args.endOrder, args.endStepOrder]
          : [args.endOrder],
        upperBoundInclusive: false,
      })
      .take(64);
    await Promise.all(messages.map((m) => deleteMessage(ctx, m)));
    return {
      isDone: messages.length < 64,
      lastOrder: messages[messages.length - 1]?.order,
      lastStepOrder: messages[messages.length - 1]?.stepOrder,
    };
  },
});

const addMessagesArgs = {
  userId: v.optional(v.string()),
  threadId: v.id("threads"),
  promptMessageId: v.optional(v.id("messages")),
  agentName: v.optional(v.string()),
  messages: v.array(vMessageWithMetadataInternal),
  embeddings: v.optional(vMessageEmbeddings),
  pending: v.optional(v.boolean()),
  failPendingSteps: v.optional(v.boolean()),
};
function extractToolCallId(message: any): string | undefined {
  if (message.role === "tool" && Array.isArray(message.content)) {
    const toolResult = message.content.find((c: any) => c.type === "tool-result");
    return toolResult?.toolCallId;
  }
  return undefined;
}

async function findAssociatedToolCall(
  ctx: any,
  threadId: any,
  toolCallId: string,
  currentOrder: number,
): Promise<any> {
  for (let searchOrder = currentOrder; searchOrder >= 0; searchOrder--) {
    const messages = await ctx.db
      .query("messages")
      .withIndex("threadId_status_tool_order_stepOrder", (q: any) =>
        q.eq("threadId", threadId).eq("status", "success")
      )
      .filter((q: any) => q.eq(q.field("order"), searchOrder))
      .order("desc")
      .collect();
    
    for (const msg of messages) {
      if (msg.message?.role === "assistant" && Array.isArray(msg.message.content)) {
        const toolCall = msg.message.content.find(
          (c: any) => c.type === "tool-call" && c.toolCallId === toolCallId
        );
        if (toolCall) {
          return msg;
        }
      }
    }
  }
  return null;
}

export const addMessages = mutation({
  args: addMessagesArgs,
  handler: addMessagesHandler,
  returns: v.object({
    messages: v.array(vMessageDoc),
  }),
});
async function addMessagesHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof addMessagesArgs>,
) {
  let userId = args.userId;
  const threadId = args.threadId;
  if (!userId && args.threadId) {
    const thread = await ctx.db.get(args.threadId);
    assert(thread, `Thread ${args.threadId} not found`);
    userId = thread.userId;
  }
  const {
    embeddings,
    failPendingSteps,
    pending,
    messages,
    promptMessageId,
    ...rest
  } = args;
  const parentMessage = promptMessageId && (await ctx.db.get(promptMessageId));
  if (failPendingSteps) {
    assert(args.threadId, "threadId is required to fail pending steps");
    const pendingMessages = await ctx.db
      .query("messages")
      .withIndex("threadId_status_tool_order_stepOrder", (q) =>
        q.eq("threadId", threadId).eq("status", "pending"),
      )
      .collect();
    await Promise.all(
      pendingMessages
        .filter((m) => !parentMessage || m.order === parentMessage.order)
        .map((m) =>
          ctx.db.patch(m._id, { status: "failed", error: "Restarting" }),
        ),
    );
  }
  let order, stepOrder;
  let fail = false;
  
  if (promptMessageId) {
    assert(parentMessage, `Parent message ${promptMessageId} not found`);
    if (parentMessage.status === "failed") {
      fail = true;
    }
    order = parentMessage.order;
    const maxMessage = await getMaxMessage(ctx, threadId, order);
    stepOrder = maxMessage?.stepOrder ?? parentMessage.stepOrder;
  } else {
    const maxMessage = await getMaxMessage(ctx, threadId);
    
    const firstMessage = messages[0];
    if (firstMessage && firstMessage.message.role === "user") {
      order = maxMessage ? maxMessage.order + 1 : 0;
      stepOrder = -1;
    } else {
      order = maxMessage ? maxMessage.order : 0;
      stepOrder = maxMessage?.stepOrder ?? -1;
    }
  }
  const toReturn: Doc<"messages">[] = [];
  if (embeddings) {
    assert(
      embeddings.vectors.length === messages.length,
      "embeddings.vectors.length must match messages.length",
    );
  }
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    let embeddingId: VectorTableId | undefined;
    if (embeddings && embeddings.vectors[i]) {
      embeddingId = await insertVector(ctx, embeddings.dimension, {
        vector: embeddings.vectors[i]!,
        model: embeddings.model,
        table: "messages",
        userId,
        threadId,
      });
    }
    
    let currentFail = fail;
    
    if (message.message.role === "user") {
      if (i === 0 && !promptMessageId) {
        stepOrder = 0;
      } else {
        stepOrder++;
      }
    } else if (message.message.role === "tool") {
      const toolCallId = extractToolCallId(message.message);
      if (toolCallId) {
        const associatedToolCall = await findAssociatedToolCall(ctx, threadId, toolCallId, order);
        if (associatedToolCall) {
          order = associatedToolCall.order;
          if (associatedToolCall.status === "failed") {
            currentFail = true;
          }
        }
      }
      stepOrder++;
    } else {
      stepOrder++;
    }

    const messageId = await ctx.db.insert("messages", {
      ...rest,
      ...message,
      embeddingId,
      parentMessageId: promptMessageId,
      userId,
      order,
      tool: isTool(message.message),
      text: extractText(message.message),
      status: currentFail ? "failed" : pending ? "pending" : "success",
      error: currentFail ? "Parent message failed" : undefined,
      stepOrder,
    });
    // Let's just not set the id field and have it set only in explicit cases.
    // if (!message.id) {
    //   await ctx.db.patch(messageId, {
    //     id: messageId,
    //   });
    // }
    if (message.fileIds) {
      await changeRefcount(ctx, [], message.fileIds);
    }
    // TODO: delete the associated stream data for the order/stepOrder
    toReturn.push((await ctx.db.get(messageId))!);
  }
  return { messages: toReturn.map(publicMessage) };
}

// exported for tests
export async function getMaxMessage(
  ctx: QueryCtx,
  threadId: Id<"threads">,
  order?: number,
) {
  return orderedMessagesStream(ctx, threadId, "desc", order).first();
}

function orderedMessagesStream(
  ctx: QueryCtx,
  threadId: Id<"threads">,
  sortOrder: "asc" | "desc",
  order?: number,
) {
  return mergedStream(
    [true, false].flatMap((tool) =>
      messageStatuses.map((status) =>
        stream(ctx.db, schema)
          .query("messages")
          .withIndex("threadId_status_tool_order_stepOrder", (q) => {
            const qq = q
              .eq("threadId", threadId)
              .eq("status", status)
              .eq("tool", tool);
            if (order) {
              return qq.eq("order", order);
            }
            return qq;
          })
          .order(sortOrder),
      ),
    ),
    ["order", "stepOrder"],
  );
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
    const messages = await orderedMessagesStream(
      ctx,
      message.threadId,
      "asc",
      message.order,
    ).collect();
    for (const m of messages) {
      if (m.status === "pending") {
        await ctx.db.patch(m._id, { status: "failed", error });
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

export const updateMessage = mutation({
  args: {
    messageId: v.id("messages"),
    patch: v.object({
      message: v.optional(vMessageDoc.fields.message),
      fileIds: v.optional(v.array(v.id("files"))),
      status: v.optional(vMessageStatus),
      error: v.optional(v.string()),
    }),
  },
  returns: vMessageDoc,
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    assert(message, `Message ${args.messageId} not found`);

    if (args.patch.fileIds) {
      await changeRefcount(ctx, message.fileIds ?? [], args.patch.fileIds);
    }

    const patch: Partial<Doc<"messages">> = {
      ...args.patch,
    };

    if (args.patch.message !== undefined) {
      patch.message = args.patch.message;
      patch.tool = isTool(args.patch.message);
      patch.text = extractText(args.patch.message);
    }

    await ctx.db.patch(args.messageId, patch);
    return publicMessage((await ctx.db.get(args.messageId))!);
  },
});

async function commitMessageHandler(
  ctx: MutationCtx,
  { messageId }: { messageId: Id<"messages"> },
) {
  const message = await ctx.db.get(messageId);
  assert(message, `Message ${messageId} not found`);

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
            .eq("order", order),
        ),
    ),
    ["order", "stepOrder"],
  ).collect();
  for (const message of messages) {
    await ctx.db.patch(message._id, { status: "success" });
  }
}

export const listMessagesByThreadId = query({
  args: {
    threadId: v.id("threads"),
    excludeToolMessages: v.optional(v.boolean()),
    /** What order to sort the messages in. To get the latest, use "desc". */
    order: v.union(v.literal("asc"), v.literal("desc")),
    paginationOpts: v.optional(paginationOptsValidator),
    statuses: v.optional(v.array(vMessageStatus)),
    upToAndIncludingMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const statuses =
      args.statuses ?? vMessageStatus.members.map((m) => m.value);
    const last =
      args.upToAndIncludingMessageId &&
      (await ctx.db.get(args.upToAndIncludingMessageId));
    assert(
      !last || last.threadId === args.threadId,
      "upToAndIncludingMessageId must be a message in the thread",
    );
    const toolOptions = args.excludeToolMessages ? [false] : [true, false];
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
            if (last) {
              return qq.lte("order", last.order);
            }
            return qq;
          })
          .order(order)
          .filterWith(
            // We allow all messages on the same order.
            async (m) =>
              !last || m.order < last.order || m.order === last.order,
          ),
      ),
    );
    const messages = await mergedStream(streams, [
      "order",
      "stepOrder",
    ]).paginate(
      args.paginationOpts ?? {
        numItems: DEFAULT_RECENT_MESSAGES,
        cursor: null,
      },
    );
    return { ...messages, page: messages.page.map(publicMessage) };
  },
  returns: vPaginationResult(vMessageDoc),
});

export const getMessagesByIds = query({
  args: {
    messageIds: v.array(v.id("messages")),
  },
  handler: async (ctx, args) => {
    return await Promise.all(args.messageIds.map((id) => ctx.db.get(id)));
  },
  returns: v.array(v.union(v.null(), vMessageDoc)),
});

export const searchMessages = action({
  args: {
    threadId: v.optional(v.id("threads")),
    searchAllMessagesForUserId: v.optional(v.string()),
    beforeMessageId: v.optional(v.id("messages")),
    embedding: v.optional(v.array(v.number())),
    embeddingModel: v.optional(v.string()),
    text: v.optional(v.string()),
    limit: v.number(),
    vectorScoreThreshold: v.optional(v.number()),
    messageRange: v.optional(
      v.object({ before: v.number(), after: v.number() }),
    ),
  },
  returns: v.array(vMessageDoc),
  handler: async (ctx, args): Promise<MessageDoc[]> => {
    assert(
      args.searchAllMessagesForUserId || args.threadId,
      "Specify userId or threadId",
    );
    const limit = args.limit;
    let textSearchMessages: MessageDoc[] | undefined;
    if (args.text) {
      textSearchMessages = await ctx.runQuery(api.messages.textSearch, {
        searchAllMessagesForUserId: args.searchAllMessagesForUserId,
        threadId: args.threadId,
        text: args.text,
        limit,
        beforeMessageId: args.beforeMessageId,
      });
    }
    if (args.embedding) {
      const dimension = args.embedding.length as VectorDimension;
      if (!VectorDimensions.includes(dimension)) {
        throw new Error(`Unsupported embedding dimension: ${dimension}`);
      }
      const vectors = (
        await searchVectors(ctx, args.embedding, {
          dimension,
          model: args.embeddingModel ?? "unknown",
          table: "messages",
          searchAllMessagesForUserId: args.searchAllMessagesForUserId,
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
      const embeddingIds = vectorScores.slice(0, limit).map((v) => v.id);
      const messages: MessageDoc[] = await ctx.runQuery(
        internal.messages._fetchSearchMessages,
        {
          searchAllMessagesForUserId: args.searchAllMessagesForUserId,
          threadId: args.threadId,
          embeddingIds,
          textSearchMessages: textSearchMessages?.filter(
            (m) => !embeddingIds.includes(m.embeddingId! as VectorTableId),
          ),
          messageRange: args.messageRange ?? DEFAULT_MESSAGE_RANGE,
          beforeMessageId: args.beforeMessageId,
          limit,
        },
      );
      return messages;
    }
    return textSearchMessages?.flat() ?? [];
  },
});

export const _fetchSearchMessages = internalQuery({
  args: {
    threadId: v.optional(v.id("threads")),
    embeddingIds: v.array(vVectorId),
    searchAllMessagesForUserId: v.optional(v.string()),
    textSearchMessages: v.optional(v.array(vMessageDoc)),
    messageRange: v.object({ before: v.number(), after: v.number() }),
    beforeMessageId: v.optional(v.id("messages")),
    limit: v.number(),
  },
  returns: v.array(vMessageDoc),
  handler: async (ctx, args): Promise<MessageDoc[]> => {
    const beforeMessage =
      args.beforeMessageId && (await ctx.db.get(args.beforeMessageId));
    const { searchAllMessagesForUserId, threadId } = args;
    assert(
      searchAllMessagesForUserId || threadId,
      "Specify searchAllMessagesForUserId or threadId to search",
    );
    let messages: MessageDoc[] = (
      await Promise.all(
        args.embeddingIds.map((embeddingId) =>
          ctx.db
            .query("messages")
            .withIndex("embeddingId_threadId", (q) =>
              searchAllMessagesForUserId
                ? q.eq("embeddingId", embeddingId)
                : q.eq("embeddingId", embeddingId).eq("threadId", threadId!),
            )
            .filter((q) =>
              q.and(
                q.eq(q.field("status"), "success"),
                searchAllMessagesForUserId
                  ? q.eq(q.field("userId"), searchAllMessagesForUserId)
                  : q.eq(q.field("threadId"), threadId),
              ),
            )
            .first(),
        ),
      )
    )
      .filter(
        (m): m is Doc<"messages"> =>
          m !== undefined &&
          m !== null &&
          !m.tool &&
          (!beforeMessage ||
            m.order < beforeMessage.order ||
            (m.order === beforeMessage.order &&
              m.stepOrder < beforeMessage.stepOrder)),
      )
      .map(publicMessage);
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
        const surrounding = await ctx.db
          .query("messages")
          .withIndex("threadId_status_tool_order_stepOrder", (q) =>
            q
              .eq("threadId", m.threadId as Id<"threads">)
              .eq("status", "success")
              .eq("tool", false)
              .gte("order", earliest)
              .lte("order", latest),
          )
          .collect();
        if (!ranges[searchId]) {
          ranges[searchId] = [];
        }
        ranges[searchId].push(...surrounding);
      }
    }
    for (const r of Object.values(ranges).flat()) {
      if (!messages.some((m) => m._id === r._id)) {
        messages.push(publicMessage(r));
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
    searchAllMessagesForUserId: v.optional(v.string()),
    text: v.string(),
    limit: v.number(),
    beforeMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    assert(
      args.searchAllMessagesForUserId || args.threadId,
      "Specify userId or threadId",
    );
    const beforeMessage =
      args.beforeMessageId && (await ctx.db.get(args.beforeMessageId));
    const order = beforeMessage?.order;
    const messages = await ctx.db
      .query("messages")
      .withSearchIndex("text_search", (q) =>
        args.searchAllMessagesForUserId
          ? q
              .search("text", args.text)
              .eq("userId", args.searchAllMessagesForUserId)
          : q.search("text", args.text).eq("threadId", args.threadId!),
      )
      // Just in case tool messages slip through
      .filter((q) => {
        const qq = q.eq(q.field("tool"), false);
        if (order) {
          return q.and(qq, q.lte(q.field("order"), order));
        }
        return qq;
      })
      .take(args.limit);
    return messages
      .filter(
        (m) =>
          !beforeMessage ||
          m.order < beforeMessage.order ||
          (m.order === beforeMessage.order &&
            m.stepOrder < beforeMessage.stepOrder),
      )
      .map(publicMessage);
  },
  returns: v.array(vMessageDoc),
});
