"use client";
import {
  type BetterOmit,
  type ErrorMessage,
  type Expand,
} from "convex-helpers";
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
import type { MessageDoc, StreamArgs } from "../../validators.js";
import type { StreamQuery } from "./types.js";
import {
  type UIMessage,
  type UIStatus,
  combineUIMessages,
  toUIMessages,
} from "../UIMessages.js";
import { sorted } from "../../shared.js";
import { useStreamingUIMessages } from "./useStreamingUIMessages.js";
import {
  resolveStreams,
  usePaginatedOrders,
  type StreamCandidate,
} from "./assemble.js";
import type { MessageDocLike } from "./useThreadMessages.js";

export type UIMessageLike = {
  order: number;
  stepOrder: number;
  status: UIStatus;
  parts: UIMessage["parts"];
  role: UIMessage["role"];
};

export type UIMessagesQuery<
  Args = unknown,
  M extends UIMessageLike | MessageDocLike = UIMessageLike | MessageDocLike,
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

export type UIMessagesQueryArgs<Query extends UIMessagesQuery<unknown, any>> =
  Query extends UIMessagesQuery<unknown, any>
    ? Expand<BetterOmit<FunctionArgs<Query>, "paginationOpts" | "streamArgs">>
    : never;

/**
 * The items the hook returns: the query's own items when it returns
 * UIMessages, or UIMessages when it returns MessageDocs.
 */
export type UIMessagesQueryResult<Query extends UIMessagesQuery<unknown, any>> =
  Query extends UIMessagesQuery<unknown, infer M>
    ? M extends UIMessageLike
      ? M
      : UIMessage
    : never;

/**
 * A hook that fetches UIMessages from a thread.
 *
 * The query returns MessageDocs (from `listMessages`), which the hook
 * assembles into UIMessages together with the streaming messages, so a
 * UIMessage is whole no matter where pagination split its documents. Pages of
 * UIMessages (from `listUIMessages`) are still accepted but legacy: each page
 * was converted on its own, so a tool approval response on a different page
 * from its tool call is lost.
 *
 * A page can end partway through a UIMessage. The hook loads the rest of the
 * oldest one before settling (reporting `LoadingMore`), so results always
 * start at a whole UIMessage and can hold more rows than `initialNumItems`.
 * Rows of older UIMessages read along the way appear on the next `loadMore`.
 *
 * This hook is a wrapper around `usePaginatedQuery` and `useStreamingUIMessages`.
 * It will fetch both full messages and streaming messages, and merge them together.
 *
 * The query must take as arguments `{ threadId, paginationOpts }` and return a
 * pagination result of MessageDocs.
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
 *     const paginated = await listMessages(ctx, components.agent, args);
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
 * pagination result of MessageDocs, or (legacy) of objects similar to
 * UIMessage with the fields role, parts, status, order and stepOrder.
 * To support streaming, it must also take in `streamArgs: vStreamArgs` and
 * return a `streams` object returned from `syncStreams`.
 * @param args The arguments to pass to the query other than `paginationOpts`
 * and `streamArgs`. So `{ threadId }` at minimum, plus any other arguments that
 * you want to pass to the query.
 * @param options The options for the query. Similar to usePaginatedQuery.
 * To enable streaming, pass `stream: true`.
 * @returns The messages. If stream is true, it will return a list of messages
 *   that includes both full messages and streaming messages.
 *   The streaming messages are materialized as UIMessages.
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
  const paginated = usePaginatedOrders(
    query,
    args as PaginatedQueryArgs<Query> | "skip",
    { initialNumItems: options.initialNumItems },
  );

  const startOrder = paginated.results.length
    ? Math.min(...paginated.results.map((m) => m.order))
    : 0;
  // These are streaming messages that will not include full messages.
  const streams = useStreamingUIMessages(
    query as StreamQuery<UIMessagesQueryArgs<Query>>,
    !options.stream ||
      args === "skip" ||
      paginated.status === "LoadingFirstPage"
      ? "skip"
      : ({ ...args, paginationOpts: { cursor: null, numItems: 0 } } as any),
    { startOrder, skipStreamIds: options.skipStreamIds },
  );

  // Rows are converted only when the loaded pages or the streams' positions
  // change, not on every delta.
  const candidatesKey = JSON.stringify(
    (streams ?? []).map(candidateOf).map((c) => ({ ...c, value: 0 })),
  );
  const assembled = useMemo(
    () =>
      assembleUIMessages(
        paginated.results,
        JSON.parse(candidatesKey) as StreamCandidate<number>[],
      ),
    [paginated.results, candidatesKey],
  );
  const results = useMemo(
    () =>
      combineUIMessages(
        sorted([
          ...assembled.messages,
          ...(streams ?? []).filter((m) => assembled.shown.has(m.id)),
        ]),
      ),
    [assembled, streams],
  );

  return { ...paginated, results } as UIMessagesQueryResult<Query>;
}

const isUIMessage = (item: UIMessageLike | MessageDocLike) =>
  Array.isArray((item as UIMessageLike).parts);

const candidateOf = (m: UIMessage): StreamCandidate<string> => ({
  id: m.id,
  order: m.order,
  stepOrder: m.stepOrder,
  live: m.status === "streaming",
  value: m.id,
});

/**
 * Resolves the streams against the loaded items and converts the remaining
 * items to UIMessages. Rows (MessageDocs) are converted together, so a step's
 * parts meet whatever page they came from; items that are already UIMessages
 * are kept as they are.
 */
function assembleUIMessages(
  items: (UIMessageLike | MessageDocLike)[],
  candidates: StreamCandidate<unknown>[],
): { messages: UIMessage[]; shown: Set<string> } {
  const resolved = resolveStreams(
    items,
    candidates.map((c) => ({ ...c, value: c.id })),
  );
  const rows = resolved.rows.filter(
    (item) => !isUIMessage(item),
  ) as MessageDoc[];
  return {
    messages: [
      ...(resolved.rows.filter(isUIMessage) as UIMessage[]),
      ...toUIMessages(rows),
    ],
    shown: new Set(resolved.streams),
  };
}
