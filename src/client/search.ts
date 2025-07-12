import type {
  AgentComponent,
  ContextOptions,
  RunActionCtx,
  RunQueryCtx,
} from "./types.js";
import type { MessageDoc } from "../component/schema.js";
import type { CoreMessage } from "ai";
import { assert } from "convex-helpers";
import {
  DEFAULT_MESSAGE_RANGE,
  DEFAULT_RECENT_MESSAGES,
  extractText,
} from "../shared.js";

const DEFAULT_VECTOR_SCORE_THRESHOLD = 0.0;

export type GetEmbedding = (text: string) => Promise<{
  vector: number[];
  vectorModel: string;
  vectorScoreThreshold?: number;
}>;

/**
 * Fetch the context messages for a thread.
 * @param ctx Either a query, mutation, or action ctx.
 *   If it is not an action context, you can't do text or
 *   vector search.
 * @param args The associated thread, user, message
 * @returns
 */
export async function fetchContextMessages(
  ctx: RunQueryCtx | RunActionCtx,
  component: AgentComponent,
  args: {
    userId: string | undefined;
    threadId: string | undefined;
    messages: CoreMessage[];
    /**
     * If provided, it will search for messages up to and including this message.
     * Note: if this is far in the past, text and vector search results may be more
     * limited, as it's post-filtering the results.
     */
    upToAndIncludingMessageId?: string;
    contextOptions: ContextOptions;
    getEmbedding?: GetEmbedding;
  }
): Promise<MessageDoc[]> {
  assert(args.userId || args.threadId, "Specify userId or threadId");
  const opts = args.contextOptions;
  // Fetch the latest messages from the thread
  let included: Set<string> | undefined;
  const contextMessages: MessageDoc[] = [];
  if (
    args.threadId &&
    (opts.recentMessages !== 0 || args.upToAndIncludingMessageId)
  ) {
    const { page } = await ctx.runQuery(
      component.messages.listMessagesByThreadId,
      {
        threadId: args.threadId,
        excludeToolMessages: opts.excludeToolMessages,
        paginationOpts: {
          numItems: opts.recentMessages ?? DEFAULT_RECENT_MESSAGES,
          cursor: null,
        },
        upToAndIncludingMessageId: args.upToAndIncludingMessageId,
        order: "desc",
        statuses: ["success"],
      }
    );
    included = new Set(page.map((m) => m._id));
    contextMessages.push(
      // Reverse since we fetched in descending order
      ...page.reverse()
    );
  }
  if (opts.searchOptions?.textSearch || opts.searchOptions?.vectorSearch) {
    const targetMessage = contextMessages.find(
      (m) => m._id === args.upToAndIncludingMessageId
    )?.message;
    const messagesToSearch = targetMessage ? [targetMessage] : args.messages;
    if (!("runAction" in ctx)) {
      throw new Error("searchUserMessages only works in an action");
    }
    const lastMessage = messagesToSearch.at(-1)!;
    assert(lastMessage, "No messages to search");
    const text = extractText(lastMessage);
    assert(text, `No text to search in message ${JSON.stringify(lastMessage)}`);
    assert(
      !args.contextOptions?.searchOptions?.vectorSearch || "runAction" in ctx,
      "You must do vector search from an action"
    );
    if (opts.searchOptions?.vectorSearch && !args.getEmbedding) {
      throw new Error(
        "You must provide an embedding and embeddingModel to use vector search"
      );
    }
    const embeddingFields = opts.searchOptions?.vectorSearch
      ? await args.getEmbedding?.(text)
      : undefined;
    const searchMessages = await ctx.runAction(
      component.messages.searchMessages,
      {
        searchAllMessagesForUserId: opts?.searchOtherThreads
          ? args.userId ??
            (args.threadId &&
              (
                await ctx.runQuery(component.threads.getThread, {
                  threadId: args.threadId,
                })
              )?.userId)
          : undefined,
        threadId: args.threadId,
        beforeMessageId: args.upToAndIncludingMessageId,
        limit: opts.searchOptions?.limit ?? 10,
        messageRange: {
          ...DEFAULT_MESSAGE_RANGE,
          ...opts.searchOptions?.messageRange,
        },
        text,
        vectorScoreThreshold:
          opts.searchOptions?.vectorScoreThreshold ??
          DEFAULT_VECTOR_SCORE_THRESHOLD,
        ...embeddingFields,
      }
    );
    // TODO: track what messages we used for context
    contextMessages.unshift(
      ...searchMessages.filter((m) => !included?.has(m._id))
    );
  }
  // Ensure we don't include tool messages without a corresponding tool call
  return filterOutOrphanedToolMessages(
    contextMessages.sort((a, b) =>
      // Sort the raw MessageDocs by order and stepOrder
      a.order === b.order ? a.stepOrder - b.stepOrder : a.order - b.order
    )
  );
}

/**
 * Filter out tool messages that don't have both a tool call and response.
 * @param docs The messages to filter.
 * @returns The filtered messages.
 */
export function filterOutOrphanedToolMessages(docs: MessageDoc[]) {
  const toolCallIds = new Set<string>();
  const result: MessageDoc[] = [];
  for (const doc of docs) {
    if (
      doc.message?.role === "assistant" &&
      Array.isArray(doc.message.content)
    ) {
      for (const content of doc.message.content) {
        if (content.type === "tool-call") {
          toolCallIds.add(content.toolCallId);
        }
      }
      result.push(doc);
    } else if (doc.message?.role === "tool") {
      if (doc.message.content.every((c) => toolCallIds.has(c.toolCallId))) {
        result.push(doc);
      } else {
        console.debug("Filtering out orphaned tool message", doc);
      }
    } else {
      result.push(doc);
    }
  }
  return result;
}
