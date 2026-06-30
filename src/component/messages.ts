import { assert, omit, pick } from "convex-helpers";
import { mergedStream, stream } from "convex-helpers/server/stream";
import {
  paginationOptsValidator,
  paginationResultValidator,
  type WithoutSystemFields,
} from "convex/server";
import type { ObjectType } from "convex/values";
import {
  DEFAULT_RECENT_MESSAGES,
  extractText,
  isTool,
} from "../shared.js";
import {
  vAgentMessageDoc,
  vMessageStatus,
  vAgentMessageInputInternal,
  type AgentMessageDoc,
} from "../validators.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  action,
  internalMutation,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server.js";
import { schema, v } from "./schema.js";
import { partial } from "convex-helpers/validators";

function publicMessage(message: Doc<"messages">): AgentMessageDoc {
  return omit(message, ["parentMessageId"]);
}

export async function deleteMessage(
  ctx: MutationCtx,
  messageDoc: Doc<"messages">,
) {
  await ctx.db.delete("messages", messageDoc._id);
}

export const deleteByIds = mutation({
  args: { messageIds: v.array(v.id("messages")) },
  returns: v.array(v.id("messages")),
  handler: async (ctx, args) => {
    const deletedMessageIds = await Promise.all(
      args.messageIds.map(async (id) => {
        const message = await ctx.db.get("messages", id);
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

export const messageStatuses = vAgentMessageDoc.fields.status.members.map(
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
  handler: async (
    ctx,
    args,
  ): Promise<{
    isDone: boolean;
    lastOrder?: number;
    lastStepOrder?: number;
  }> => {
    const messages = await orderedMessagesStream(ctx, {
      threadId: args.threadId,
      sortOrder: "asc",
      startOrder: args.startOrder,
      startOrderBound: "gte",
    })
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
      lastOrder: messages.at(-1)?.order,
      lastStepOrder: messages.at(-1)?.stepOrder,
    };
  },
});

const addMessagesArgs = {
  userId: v.optional(v.string()),
  threadId: v.id("threads"),
  promptMessageId: v.optional(v.id("messages")),
  agentName: v.optional(v.string()),
  messages: v.array(vAgentMessageInputInternal),
  failPendingSteps: v.optional(v.boolean()),
  // A pending message to update. If the pending message failed, abort.
  pendingMessageId: v.optional(v.id("messages")),
};
export const addMessages = mutation({
  args: addMessagesArgs,
  handler: addMessagesHandler,
  returns: v.object({ messages: v.array(vAgentMessageDoc) }),
});
export async function addMessagesHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof addMessagesArgs>,
) {
  let userId = args.userId;
  const threadId = args.threadId;
  if (!userId && args.threadId) {
    const thread = await ctx.db.get("threads", args.threadId);
    assert(thread, `Thread ${args.threadId} not found`);
    userId = thread.userId;
  }
  const {
    failPendingSteps,
    messages,
    promptMessageId,
    pendingMessageId,
    ...rest
  } = args;
  const promptMessage = promptMessageId && (await ctx.db.get("messages", promptMessageId));
  if (failPendingSteps) {
    assert(args.threadId, "threadId is required to fail pending steps");
    const pendingMessages = await ctx.db
      .query("messages")
      .withIndex("threadId_status_tool_order_stepOrder", (q) =>
        q.eq("threadId", threadId).eq("status", "pending"),
      )
      .order("desc")
      .take(100);
    await Promise.all(
      pendingMessages
        .filter((m) => !promptMessage || m.order === promptMessage.order)
        .filter((m) => !pendingMessageId || m._id !== pendingMessageId)
        .map(async (m) =>
          ctx.db.patch("messages", m._id, {
            status: "failed",
            error: "Restarting",
          }),
        ),
    );
  }
  let order, stepOrder;
  let fail = false;
  let error: string | undefined;
  if (promptMessageId) {
    assert(promptMessage, `Parent message ${promptMessageId} not found`);
    if (promptMessage.status === "failed") {
      fail = true;
      error = promptMessage.error ?? error ?? "The prompt message failed";
    }
    order = promptMessage.order;
    // Defend against there being existing messages with this parent.
    const maxMessage = await getMaxMessage(ctx, threadId, order);
    stepOrder = maxMessage?.stepOrder ?? promptMessage.stepOrder;
  } else {
    const maxMessage = await getMaxMessage(ctx, threadId);
    order = maxMessage?.order ?? -1;
    stepOrder = maxMessage?.stepOrder ?? -1;
  }
  const toReturn: Doc<"messages">[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const messageDoc: Omit<
      WithoutSystemFields<Doc<"messages">>,
      "order" | "stepOrder"
    > = {
      ...rest,
      ...message,
      parentMessageId: promptMessageId,
      userId,
      tool: isTool(message.message),
      text: extractText(message.message),
      status: fail ? "failed" : (message.status ?? "success"),
      error: fail ? error : message.error,
    };
    // If there is a pending message, we replace that one with the first message
    // and subsequent ones will follow the regular order/subOrder advancement.
    if (i === 0 && pendingMessageId) {
      const pendingMessage = await ctx.db.get("messages", pendingMessageId);
      assert(pendingMessage, `Pending msg ${pendingMessageId} not found`);
      if (pendingMessage.status === "failed") {
        fail = true;
        error =
          `Trying to update a message that failed: ${pendingMessageId}, ` +
          `error: ${pendingMessage.error ?? error}`;
        messageDoc.status = "failed";
        messageDoc.error = error;
      }
      await ctx.db.replace("messages", pendingMessage._id, {
        ...messageDoc,
        order: pendingMessage.order,
        stepOrder: pendingMessage.stepOrder,
      });
      toReturn.push((await ctx.db.get("messages", pendingMessage._id))!);
      continue;
    }
    if (message.message.author.type === "user") {
      if (promptMessage && promptMessage.order === order) {
        // see if there's a later message than the parent message order
        const maxMessage = await getMaxMessage(ctx, threadId);
        order = (maxMessage?.order ?? order) + 1;
      } else {
        order++;
      }
      stepOrder = 0;
    } else {
      if (order < 0) {
        order = 0;
      }
      stepOrder++;
    }
    const messageId = await ctx.db.insert("messages", {
      ...messageDoc,
      order,
      stepOrder,
    });
    toReturn.push((await ctx.db.get("messages", messageId))!);
  }
  return { messages: toReturn.map(publicMessage) };
}

// exported for tests
export async function getMaxMessage(
  ctx: QueryCtx,
  threadId: Id<"threads">,
  order?: number,
) {
  return orderedMessagesStream(ctx, {
    threadId,
    sortOrder: "desc",
    startOrder: order,
    startOrderBound: "eq",
  }).first();
}

function orderedMessagesStream(
  ctx: QueryCtx,
  args: {
    threadId: Id<"threads">;
    sortOrder: "asc" | "desc";
    startOrder?: number;
    startOrderBound?: "gte" | "eq";
  },
) {
  return mergedStream(
    [true, false].flatMap((tool) =>
      messageStatuses.map((status) =>
        stream(ctx.db, schema)
          .query("messages")
          .withIndex("threadId_status_tool_order_stepOrder", (q) => {
            const qq = q
              .eq("threadId", args.threadId)
              .eq("status", status)
              .eq("tool", tool);
            if (args.startOrder !== undefined) {
              if (args.startOrderBound === "gte") {
                return qq.gte("order", args.startOrder);
              } else {
                return qq.eq("order", args.startOrder);
              }
            }
            return qq;
          })
          .order(args.sortOrder),
      ),
    ),
    ["order", "stepOrder"],
  );
}

export const finalizeMessage = mutation({
  args: {
    messageId: v.id("messages"),
    result: v.union(
      v.object({ status: v.literal("success") }),
      v.object({ status: v.literal("failed"), error: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, result }) => {
    const message = await ctx.db.get("messages", messageId);
    assert(message, `Message ${messageId} not found`);
    if (message.status !== "pending") {
      return;
    }
    if (result.status === "failed") {
      await ctx.db.patch("messages", messageId, {
        status: "failed",
        error: result.error,
      });
    } else {
      await ctx.db.patch("messages", messageId, { status: "success" });
    }
  },
});

export const updateMessage = mutation({
  args: {
    messageId: v.id("messages"),
    patch: v.object(
      partial(
        pick(schema.tables.messages.validator.fields, [
          "message",
          "status",
          "error",
        ]),
      ),
    ),
  },
  returns: vAgentMessageDoc,
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    assert(message, `Message ${args.messageId} not found`);

    const patch: Partial<Doc<"messages">> = { ...args.patch };

    if (args.patch.message !== undefined) {
      patch.message = args.patch.message;
      patch.tool = isTool(args.patch.message);
      patch.text = extractText(args.patch.message);
    }

    await ctx.db.patch("messages", args.messageId, patch);
    return publicMessage((await ctx.db.get("messages", args.messageId))!);
  },
});

const cloneMessageArgs = {
  sourceThreadId: v.id("threads"),
  targetThreadId: v.id("threads"),
  // defaults to false, so tool calls & responses will be copied
  excludeToolMessages: v.optional(v.boolean()),
  // defaults to copying all messages, but you could just copy success messages.
  statuses: v.optional(v.array(vMessageStatus)),
  // stop at this message id
  upToAndIncludingMessageId: v.optional(v.id("messages")),
  // defaults to 0. the messages will be inserted starting at this order.
  insertAtOrder: v.optional(v.number()),
};
export const cloneMessageBatch = internalMutation({
  args: {
    ...cloneMessageArgs,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    numCopied: number;
    continueCursor: string;
    isDone: boolean;
  }> => {
    const orderOffset = args.insertAtOrder ?? 0;
    const result = await listMessagesByThreadIdHandler(ctx, {
      threadId: args.sourceThreadId,
      excludeToolMessages: args.excludeToolMessages,
      order: "desc",
      paginationOpts: args.paginationOpts,
      statuses: args.statuses,
      upToAndIncludingMessageId: args.upToAndIncludingMessageId,
    });

    const existing =
      result.page.length === 0
        ? []
        : await mergedStream(
            [true, false].flatMap((tool) =>
              messageStatuses.map((status) =>
                stream(ctx.db, schema)
                  .query("messages")
                  .withIndex("threadId_status_tool_order_stepOrder", (q) =>
                    q
                      .eq("threadId", args.targetThreadId)
                      .eq("status", status)
                      .eq("tool", tool)
                      .gte("order", result.page[0].order)
                      .lte("order", result.page[result.page.length - 1].order),
                  ),
              ),
            ),
            ["order", "stepOrder"],
          ).collect();

    await Promise.all(
      result.page
        .filter(
          (m) =>
            !existing.some(
              (e) => e.order === m.order && e.stepOrder === m.stepOrder,
            ),
        )
        .map(async (m) => {
          await ctx.db.insert("messages", {
            ...omit(m, ["_id", "_creationTime", "threadId", "order"]),
            threadId: args.targetThreadId,
            order: orderOffset + m.order,
          });
        }),
    );
    return {
      numCopied: result.page.length,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const cloneThread = action({
  args: {
    ...cloneMessageArgs,
    batchSize: v.optional(v.number()),
    // how many messages to copy
    limit: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let cursor: string | null = null;
    let copiedSoFar = 0;
    while (copiedSoFar < (args.limit ?? Infinity)) {
      const numToCopy = Math.min(
        args.batchSize ?? DEFAULT_RECENT_MESSAGES,
        args.limit ?? Infinity - copiedSoFar,
      );
      const result: {
        numCopied: number;
        continueCursor: string;
        isDone: boolean;
      } = await ctx.runMutation(internal.messages.cloneMessageBatch, {
        ...args,
        paginationOpts: {
          cursor,
          numItems: numToCopy,
        },
      });
      copiedSoFar += result.numCopied;
      cursor = result.continueCursor;
      if (result.isDone) {
        break;
      }
    }
    return copiedSoFar;
  },
});

export const listMessagesByThreadIdArgs = {
  threadId: v.id("threads"),
  excludeToolMessages: v.optional(v.boolean()),
  /** What order to sort the messages in. To get the latest, use "desc". */
  order: v.union(v.literal("asc"), v.literal("desc")),
  paginationOpts: v.optional(paginationOptsValidator),
  statuses: v.optional(v.array(vMessageStatus)),
  upToAndIncludingMessageId: v.optional(v.id("messages")),
};
export const listMessagesByThreadId = query({
  args: listMessagesByThreadIdArgs,
  handler: async (ctx, args) => {
    const messages = await listMessagesByThreadIdHandler(ctx, args);
    return { ...messages, page: messages.page.map(publicMessage) };
  },
  returns: paginationResultValidator(vAgentMessageDoc),
});

async function listMessagesByThreadIdHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof listMessagesByThreadIdArgs>,
) {
  const statuses = args.statuses ?? vMessageStatus.members.map((m) => m.value);
  const last =
    args.upToAndIncludingMessageId &&
    (await ctx.db.get("messages", args.upToAndIncludingMessageId));
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
          async (m) => !last || m.order <= last.order,
        ),
    ),
  );
  const messages = await mergedStream(streams, ["order", "stepOrder"]).paginate(
    args.paginationOpts ?? {
      numItems: DEFAULT_RECENT_MESSAGES,
      cursor: null,
    },
  );
  if (messages.page.length === 0) {
    messages.isDone = true;
  }
  return messages;
}

export const getMessagesByIds = query({
  args: { messageIds: v.array(v.id("messages")) },
  handler: async (ctx, args) => {
    return (await Promise.all(args.messageIds.map((id) => ctx.db.get("messages", id)))).map(
      (m) => (m ? publicMessage(m) : null),
    );
  },
  returns: v.array(v.union(v.null(), vAgentMessageDoc)),
});

// returns ranges of messages in order of text search relevance,
// excluding duplicates in later ranges.
export const textSearch = query({
  args: {
    threadId: v.optional(v.id("threads")),
    searchAllMessagesForUserId: v.optional(v.string()),
    text: v.optional(v.string()),
    targetMessageId: v.optional(v.id("messages")),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    assert(
      args.searchAllMessagesForUserId || args.threadId,
      "Specify userId or threadId",
    );
    const targetMessage =
      args.targetMessageId && (await ctx.db.get("messages", args.targetMessageId));
    const order = targetMessage?.order;
    const text = args.text || targetMessage?.text;
    if (!text) {
      return [];
    }
    const messages = await ctx.db
      .query("messages")
      .withSearchIndex("text_search", (q) =>
        args.searchAllMessagesForUserId
          ? q.search("text", text).eq("userId", args.searchAllMessagesForUserId)
          : q.search("text", text).eq("threadId", args.threadId!),
      )
      // Just in case tool messages slip through
      // eslint-disable-next-line @convex-dev/no-filter-in-query
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
          !targetMessage ||
          m.order < targetMessage.order ||
          (m.order === targetMessage.order &&
            m.stepOrder < targetMessage.stepOrder),
      )
      .map(publicMessage);
  },
  returns: v.array(vAgentMessageDoc),
});
