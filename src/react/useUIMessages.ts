"use client";
import {
  type BetterOmit,
  type ErrorMessage,
  type Expand,
} from "convex-helpers";
import { usePaginatedQuery } from "convex-helpers/react";
import {
  type PaginatedQueryArgs,
  type UsePaginatedQueryResult,
} from "convex/react";
import type {
  FunctionArgs,
  FunctionReference,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import { useMemo } from "react";
import type { SyncStreamsReturnValue } from "../client/types.js";
import type { StreamArgs } from "../validators.js";
import type { StreamQuery } from "./types.js";
import {
  type UIMessage,
  type UIStatus,
  combineUIMessages,
} from "../UIMessages.js";
import { sorted } from "../shared.js";
import { useStreamingUIMessages } from "./useStreamingUIMessages.js";

export type UIMessageLike = {
  order: number;
  stepOrder: number;
  status: UIStatus;
  parts: UIMessage["parts"];
  role: UIMessage["role"];
};

export type UIMessagesQuery<
  Args = unknown,
  M extends UIMessageLike = UIMessageLike,
> = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
    paginationOpts: PaginationOptions;
    /**
     * If { stream: true } is passed, it will also query for stream deltas.
     * In order for this to work, the query must take as an argument streamArgs.
     */
    streamArgs?: StreamArgs;
  } & Args,
  PaginationResult<M> & { streams?: SyncStreamsReturnValue }
>;

export type UIMessagesQueryArgs<
  Query extends UIMessagesQuery<unknown, UIMessageLike>,
> =
  Query extends UIMessagesQuery<unknown, UIMessageLike>
    ? Expand<BetterOmit<FunctionArgs<Query>, "paginationOpts" | "streamArgs">>
    : never;

export type UIMessagesQueryResult<
  Query extends UIMessagesQuery<unknown, UIMessageLike>,
> = Query extends UIMessagesQuery<unknown, infer M> ? M : never;

/**
 * A hook that fetches UIMessages from a thread.
 *
 * It's similar to useThreadMessages, for endpoints that return UIMessages.
 * The streaming messages are materialized as UIMessages. The rest are passed
 * through from the query.
 *
 * This hook is a wrapper around `usePaginatedQuery` and `useStreamingUIMessages`.
 * It will fetch both full messages and streaming messages, and merge them together.
 *
 * The query must take as arguments `{ threadId, paginationOpts }` and return a
 * pagination result of objects similar to UIMessage:
 *
 * For streaming, it should look like this:
 * ```ts
 * export const listThreadMessages = query({
 *   args: {
 *     threadId: v.string(),
 *     paginationOpts: paginationOptsValidator,
 *     streamArgs: vStreamArgs,
 *     ... other arguments you want
 *   },
 *   handler: async (ctx, args) => {
 *     // await authorizeThreadAccess(ctx, threadId);
 *     // NOTE: listUIMessages returns UIMessages, not MessageDocs.
 *     const paginated = await listUIMessages(ctx, components.agent, args);
 *     const streams = await syncStreams(ctx, components.agent, args);
 *     // Here you could filter out / modify the documents & stream deltas.
 *     return { ...paginated, streams };
 *   },
 * });
 * ```
 *
 * Then the hook can be used like this:
 * ```ts
 * const { results, status, loadMore } = useUIMessages(
 *   api.myModule.listThreadMessages,
 *   { threadId },
 *   { initialNumItems: 10, stream: true }
 * );
 * ```
 *
 * @param query The query to use to fetch messages.
 * It must take as arguments `{ threadId, paginationOpts }` and return a
 * pagination result of objects similar to UIMessage:
 * Required fields: (role, parts, status, order, stepOrder).
 * To support streaming, it must also take in `streamArgs: vStreamArgs` and
 * return a `streams` object returned from `syncStreams`.
 * @param args The arguments to pass to the query other than `paginationOpts`
 * and `streamArgs`. So `{ threadId }` at minimum, plus any other arguments that
 * you want to pass to the query.
 * @param options The options for the query. Similar to usePaginatedQuery.
 * To enable streaming, pass `stream: true`.
 * @returns The messages. If stream is true, it will return a list of messages
 *   that includes both full messages and streaming messages.
 *   The streaming messages are materialized as UIMessages. The rest are passed
 *   through from the query.
 */
export function useUIMessages<Query extends UIMessagesQuery<any, any>>(
  query: Query,
  args: UIMessagesQueryArgs<Query> | "skip",
  options: {
    initialNumItems: number;
    stream?: Query extends StreamQuery
      ? boolean
      : ErrorMessage<"To enable streaming, your query must take in streamArgs: vStreamArgs and return a streams object returned from syncStreams. See docs.">;
    skipStreamIds?: string[];
  },
): UsePaginatedQueryResult<UIMessagesQueryResult<Query>> {
  // These are full messages
  const paginated = usePaginatedQuery(
    query,
    args as PaginatedQueryArgs<Query> | "skip",
    { initialNumItems: options.initialNumItems },
  );

  const startOrder = paginated.results.length
    ? Math.min(...paginated.results.map((m) => m.order))
    : 0;
  // These are streaming messages that will not include full messages.
  const streamMessages = useStreamingUIMessages(
    query as StreamQuery<UIMessagesQueryArgs<Query>>,
    !options.stream ||
      args === "skip" ||
      paginated.status === "LoadingFirstPage"
      ? "skip"
      : ({ ...args, paginationOpts: { cursor: null, numItems: 0 } } as any),
    { startOrder, skipStreamIds: options.skipStreamIds },
  );

  const merged = useMemo(() => {
    // Combine saved messages with streaming messages, then combine by order
    // This ensures streaming continuations appear in the same bubble as saved content
    const allMessages = dedupeMessages(paginated.results, streamMessages ?? []);
    const combined = combineUIMessages(sorted(allMessages));

    return {
      ...paginated,
      results: combined,
    };
  }, [paginated, streamMessages]);

  return merged as UIMessagesQueryResult<Query>;
}

/**
 * Reconciles saved messages (from DB) with streaming messages (real-time deltas).
 *
 * This is complex because they're independent data sources that can have overlapping
 * stepOrders with different content. For example, after tool approval:
 * - Saved message has tool call + result parts
 * - Streaming message starts empty and builds up continuation text
 * - Both may have the same stepOrder
 *
 * We merge rather than pick one to preserve both the tool context and streaming content.
 * A cleaner architecture would have streaming carry forward prior context, eliminating
 * the need for client-side reconciliation.
 */
export function dedupeMessages<
  M extends {
    order: number;
    stepOrder: number;
    status: UIStatus;
  },
>(messages: M[], streamMessages: M[]): M[] {
  // Filter out stale streaming messages - those with stepOrder lower than
  // the max saved message at the same order (they're from a previous generation)
  const maxStepOrderByOrder = new Map<number, number>();
  for (const msg of messages) {
    const current = maxStepOrderByOrder.get(msg.order) ?? -1;
    if (msg.stepOrder > current) {
      maxStepOrderByOrder.set(msg.order, msg.stepOrder);
    }
  }

  const filteredStreamMessages = streamMessages.filter((s) => {
    const maxSaved = maxStepOrderByOrder.get(s.order);
    // Keep streaming message if:
    // 1. No saved at that order, OR
    // 2. stepOrder >= max saved stepOrder, OR
    // 3. There's a saved message at the SAME stepOrder (let dedup logic handle it)
    const hasSavedAtSameStepOrder = messages.some(
      (m) => m.order === s.order && m.stepOrder === s.stepOrder,
    );
    return (
      maxSaved === undefined ||
      s.stepOrder >= maxSaved ||
      hasSavedAtSameStepOrder
    );
  });

  // Merge saved and streaming messages, deduplicating by (order, stepOrder)
  // When saved (with parts) and streaming (building up) have the same stepOrder,
  // we need to keep the saved parts while showing streaming status.
  return sorted(messages.concat(filteredStreamMessages)).reduce((msgs, msg) => {
    const last = msgs.at(-1);
    if (!last) {
      return [msg];
    }
    if (last.order !== msg.order || last.stepOrder !== msg.stepOrder) {
      return [...msgs, msg];
    }
    // Same (order, stepOrder) - merge them rather than choosing one
    // This preserves saved parts while allowing streaming status to show
    const lastIsFinalized =
      last.status === "success" || last.status === "failed";
    const msgIsFinalized = msg.status === "success" || msg.status === "failed";

    // If either is finalized, use the finalized one
    if (lastIsFinalized && !msgIsFinalized) {
      return msgs;
    }
    if (msgIsFinalized && !lastIsFinalized) {
      return [...msgs.slice(0, -1), msg];
    }
    if (lastIsFinalized && msgIsFinalized) {
      return msgs; // Both finalized, keep first
    }

    // Neither finalized - merge parts from both, prefer streaming message identity
    const lastParts = "parts" in last ? ((last as any).parts ?? []) : [];
    const msgParts = "parts" in msg ? ((msg as any).parts ?? []) : [];
    const hasParts = lastParts.length > 0 || msgParts.length > 0;

    // If no parts on either, just pick the streaming one (or msg if it's streaming)
    if (!hasParts) {
      if (msg.status === "streaming") {
        return [...msgs.slice(0, -1), msg];
      }
      if (last.status === "streaming") {
        return msgs;
      }
      return [...msgs.slice(0, -1), msg];
    }

    // Combine parts, avoiding duplicates by toolCallId
    const mergedParts = [...lastParts];
    for (const part of msgParts) {
      const toolCallId = (part as any).toolCallId;
      if (toolCallId) {
        const existingIdx = mergedParts.findIndex(
          (p: any) => p.toolCallId === toolCallId,
        );
        if (existingIdx >= 0) {
          // Merge tool part - prefer the one with more complete state
          const existing = mergedParts[existingIdx] as any;
          if (
            part.state === "output-available" ||
            part.state === "output-error" ||
            (part.state && !existing.state)
          ) {
            mergedParts[existingIdx] = part;
          }
          continue;
        }
      }
      // Add non-duplicate parts (skip duplicate step-starts)
      const isDuplicateStepStart =
        (part as any).type === "step-start" &&
        mergedParts.some((p: any) => p.type === "step-start");
      if (!isDuplicateStepStart) {
        mergedParts.push(part);
      }
    }

    // Use streaming message as base if it's streaming, otherwise use the one with more parts
    const base = msg.status === "streaming" ? msg : last;
    const merged = {
      ...base,
      status: msg.status === "streaming" ? "streaming" : last.status,
      parts: mergedParts,
    } as M;
    return [...msgs.slice(0, -1), merged];
  }, [] as M[]);
}
