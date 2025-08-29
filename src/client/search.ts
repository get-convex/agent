import {
  embedMany as embedMany_,
  type EmbeddingModel,
  type ModelMessage,
} from "ai";
import { assert } from "convex-helpers";
import type { MessageDoc } from "../component/schema.js";
import {
  validateVectorDimension,
  type VectorDimension,
} from "../component/vector/tables.js";
import {
  DEFAULT_MESSAGE_RANGE,
  DEFAULT_RECENT_MESSAGES,
  extractText,
  getModelName,
  getProviderName,
  isTool,
  sorted,
} from "../shared.js";
import type { Message } from "../validators.js";
import type {
  AgentComponent,
  Config,
  ContextOptions,
  RunActionCtx,
  RunQueryCtx,
} from "./types.js";

const DEFAULT_VECTOR_SCORE_THRESHOLD = 0.0;
// 10k characters should be more than enough for most cases, and stays under
// the 8k token limit for some models.
const MAX_EMBEDDING_TEXT_LENGTH = 10_000;

export type GetEmbedding = (text: string) => Promise<{
  embedding: number[];
  textEmbeddingModel: string | EmbeddingModel<string>;
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
    messages: (ModelMessage | Message)[];
    /**
     * If provided, it will search for messages up to and including this message.
     * Note: if this is far in the past, text and vector search results may be more
     * limited, as it's post-filtering the results.
     */
    upToAndIncludingMessageId?: string;
    contextOptions: ContextOptions;
    getEmbedding?: GetEmbedding;
  },
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
      },
    );
    included = new Set(page.map((m) => m._id));
    contextMessages.push(
      // Reverse since we fetched in descending order
      ...page.reverse(),
    );
  }
  if (
    (opts.searchOptions?.textSearch || opts.searchOptions?.vectorSearch) &&
    opts.searchOptions?.limit
  ) {
    const targetMessage = contextMessages.find(
      (m) => m._id === args.upToAndIncludingMessageId,
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
      "You must do vector search from an action",
    );
    if (opts.searchOptions?.vectorSearch && !args.getEmbedding) {
      throw new Error(
        "You must provide an embedding and embeddingModel to use vector search",
      );
    }
    const embeddingFields =
      opts.searchOptions?.vectorSearch && text
        ? await args.getEmbedding?.(text)
        : undefined;
    const searchMessages = await ctx.runAction(
      component.messages.searchMessages,
      {
        searchAllMessagesForUserId: opts?.searchOtherThreads
          ? (args.userId ??
            (args.threadId &&
              (
                await ctx.runQuery(component.threads.getThread, {
                  threadId: args.threadId,
                })
              )?.userId))
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
        embedding: embeddingFields?.embedding,
        embeddingModel: embeddingFields?.textEmbeddingModel
          ? getModelName(embeddingFields.textEmbeddingModel)
          : undefined,
      },
    );
    // TODO: track what messages we used for context
    contextMessages.unshift(
      ...searchMessages.filter((m) => !included?.has(m._id)),
    );
  }
  // Ensure we don't include tool messages without a corresponding tool call
  return filterOutOrphanedToolMessages(sorted(contextMessages));
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

export async function embedMessages(
  ctx: RunActionCtx,
  {
    userId,
    threadId,
    ...options
  }: { userId: string | undefined; threadId: string | undefined } & Config & {
      agentName?: string;
    },
  messages: (ModelMessage | Message)[],
): Promise<
  | {
      vectors: (number[] | null)[];
      dimension: VectorDimension;
      model: string;
    }
  | undefined
> {
  if (!options.textEmbeddingModel) {
    return undefined;
  }
  let embeddings:
    | {
        vectors: (number[] | null)[];
        dimension: VectorDimension;
        model: string;
      }
    | undefined;
  const messageTexts = messages.map((m) => !isTool(m) && extractText(m));
  // Find the indexes of the messages that have text.
  const textIndexes = messageTexts
    .map((t, i) => (t ? i : undefined))
    .filter((i) => i !== undefined);
  if (textIndexes.length === 0) {
    return undefined;
  }
  const values = messageTexts
    .map((t) => t && t.trim().slice(0, MAX_EMBEDDING_TEXT_LENGTH))
    .filter((t): t is string => !!t);
  // Then embed those messages.
  const textEmbeddings = await embedMany(ctx, {
    ...options,
    userId,
    threadId,
    values,
  });
  // Then assemble the embeddings into a single array with nulls for the messages without text.
  const embeddingsOrNull = Array(messages.length).fill(null);
  textIndexes.forEach((i, j) => {
    embeddingsOrNull[i] = textEmbeddings.embeddings[j];
  });
  if (textEmbeddings.embeddings.length > 0) {
    const dimension = textEmbeddings.embeddings[0].length;
    validateVectorDimension(dimension);
    const model = getModelName(options.textEmbeddingModel);
    embeddings = { vectors: embeddingsOrNull, dimension, model };
  }
  return embeddings;
}

export async function embedMany(
  ctx: RunActionCtx,
  {
    userId,
    threadId,
    values,
    abortSignal,
    headers,
    agentName,
    usageHandler,
    textEmbeddingModel,
    callSettings,
  }: {
    userId: string | undefined;
    threadId: string | undefined;
    values: string[];
    abortSignal?: AbortSignal;
    headers?: Record<string, string>;
    agentName?: string;
  } & Config,
): Promise<{ embeddings: number[][] }> {
  const embeddingModel = textEmbeddingModel;
  assert(
    embeddingModel,
    "a textEmbeddingModel is required to be set for vector search",
  );
  const result = await embedMany_({
    ...callSettings,
    model: embeddingModel,
    values,
    abortSignal,
    headers,
  });
  if (usageHandler && result.usage) {
    await usageHandler(ctx, {
      userId,
      threadId,
      agentName,
      model: getModelName(embeddingModel),
      provider: getProviderName(embeddingModel),
      providerMetadata: undefined,
      usage: {
        inputTokens: result.usage.tokens,
        outputTokens: 0,
        totalTokens: result.usage.tokens,
      },
    });
  }
  return { embeddings: result.embeddings };
}
