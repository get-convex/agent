"use client";
import { omit, type ErrorMessage } from "convex-helpers";
import {
  type PaginatedQueryArgs,
  type UsePaginatedQueryResult,
  type UsePaginatedQueryReturnType,
  useQuery,
} from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import type { FunctionArgs, PaginationResult } from "convex/server";
import { useMemo, useRef, useState } from "react";
import type { MessageDoc } from "../client/index.js";
import type { SyncStreamsReturnValue } from "../client/types.js";
import type { StreamArgs } from "../validators.js";
import { mergeDeltas } from "./deltas.js";
import type {
  ThreadQuery,
  ThreadStreamQuery,
  ThreadMessagesArgs,
  ThreadMessagesResult,
  MessageLike,
} from "./types.js";

/**
 * A hook that fetches messages from a thread.
 *
 * This hook is a wrapper around `usePaginatedQuery` and `useStreamingThreadMessages`.
 * It will fetch both full messages and streaming messages, and merge them together.
 *
 * The query must take as arguments `{ threadId, paginationOpts }` and return a
 * pagination result of objects that extend `MessageDoc`.
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
 *   handler: async (ctx, { threadId, paginationOpts, streamArgs }) => {
 *     // await authorizeThreadAccess(ctx, threadId);
 *     const paginated = await agent.listMessages(ctx, { threadId, paginationOpts });
 *     const streams = await agent.syncStreams(ctx, { threadId, streamArgs });
 *     // Here you could filter out / modify the documents & stream deltas.
 *     return { ...paginated, streams };
 *   },
 * });
 * ```
 *
 * Then the hook can be used like this:
 * ```ts
 * const messages = useThreadMessages(
 *   api.myModule.listThreadMessages,
 *   { threadId },
 *   { initialNumItems: 10, stream: true }
 * );
 * ```
 *
 * @param query The query to use to fetch messages.
 * It must take as arguments `{ threadId, paginationOpts }` and return a
 * pagination result of objects that extend `MessageDoc`.
 * To support streaming, it must also take in `streamArgs: vStreamArgs` and
 * return a `streams` object returned from `agent.syncStreams`.
 * @param args The arguments to pass to the query other than `paginationOpts`
 * and `streamArgs`. So `{ threadId }` at minimum, plus any other arguments that
 * you want to pass to the query.
 * @param options The options for the query. Similar to usePaginatedQuery.
 * To enable streaming, pass `stream: true`.
 * @returns The messages. If stream is true, it will return a list of messages
 *   that includes both full messages and streaming messages.
 */
export function useThreadMessages<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Query extends ThreadQuery<any, any>,
>(
  query: Query,
  args: ThreadMessagesArgs<Query> | "skip",
  options: {
    initialNumItems: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stream?: Query extends ThreadStreamQuery
      ? boolean
      : ErrorMessage<"To enable streaming, your query must take in streamArgs: vStreamArgs and return a streams object returned from agent.syncStreams. See docs.">;
  },
): UsePaginatedQueryResult<
  ThreadMessagesResult<Query> & { streaming?: boolean }
> {
  // These are full messages
  const paginated = usePaginatedQuery(
    query,
    args as PaginatedQueryArgs<Query> | "skip",
    { initialNumItems: options.initialNumItems },
  );

  let startOrder = paginated.results.at(-1)?.order ?? 0;
  for (let i = paginated.results.length - 1; i >= 0; i--) {
    const m = paginated.results[i];
    if (!m.streaming && m.status === "pending") {
      // round down to the nearest 10 for some cache benefits
      startOrder = m.order - (m.order % 10);
      break;
    }
  }
  // These are streaming messages that will not include full messages.
  const streamMessages = useStreamingThreadMessages(
    query as ThreadStreamQuery<
      ThreadMessagesArgs<Query>,
      ThreadMessagesResult<Query>
    >,
    !options.stream ||
      args === "skip" ||
      paginated.status === "LoadingFirstPage"
      ? "skip"
      : { ...args, startOrder },
  );

  const merged = useMemo(() => {
    const streamListMessages =
      streamMessages?.map((m) => ({
        ...m,
        streaming: !m.status || m.status === "pending",
      })) ?? [];
    return {
      ...paginated,
      results: paginated.results
        .map((m) => ({ ...m, streaming: false }))
        // Note: this is intentionally after paginated results.
        .concat(streamListMessages)
        .sort((a, b) =>
          a.order === b.order ? a.stepOrder - b.stepOrder : a.order - b.order,
        )
        .reduce(
          (msgs, msg) => {
            const last = msgs.at(-1);
            if (!last) {
              return [msg];
            }
            if (last.order !== msg.order || last.stepOrder !== msg.stepOrder) {
              return [...msgs, msg];
            }
            if (
              last.status === "pending" &&
              (msg.streaming || msg.status !== "pending")
            ) {
              // Let's prefer a streaming or finalized message over a pending
              // one.
              return [...msgs.slice(0, -1), msg];
            }
            // skip the new one if the previous one (listed) was finalized
            return msgs;
          },
          [] as (ThreadMessagesResult<Query> & { streaming: boolean })[],
        ),
    };
  }, [paginated, streamMessages]);

  return merged as ThreadMessagesResult<Query>;
}

/**
 * A hook that fetches streaming messages from a thread.
 * This ONLY returns streaming messages. To get both, use `useThreadMessages`.
 *
 * @param query The query to use to fetch messages.
 * It must take as arguments `{ threadId, paginationOpts, streamArgs }` and
 * return a `streams` object returned from `agent.syncStreams`.
 * @param args The arguments to pass to the query other than `paginationOpts`
 * and `streamArgs`. So `{ threadId }` at minimum, plus any other arguments that
 * you want to pass to the query.
 * @returns The streaming messages.
 */
export function useStreamingThreadMessages<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Query extends ThreadStreamQuery<any, any>,
>(
  query: Query,
  args: (ThreadMessagesArgs<Query> & { startOrder?: number }) | "skip",
): Array<ThreadMessagesResult<Query>> | undefined {
  // Invariant: streamMessages[streamId] is comprised of all deltas up to the
  // cursor. There can be multiple messages in the same stream, e.g. for tool
  // calls.
  const [streams, setStreams] = useState<
    Array<{ streamId: string; cursor: number; messages: MessageDoc[] }>
  >([]);
  const queryArgs = args === "skip" ? args : omit(args, ["startOrder"]);
  // Get all the active streams
  const streamList = useQuery(
    query,
    queryArgs === "skip"
      ? queryArgs
      : ({
          ...queryArgs,
          paginationOpts: { cursor: null, numItems: 0 },
          streamArgs: {
            kind: "list",
            startOrder: queryArgs.startOrder ?? 0,
          } as StreamArgs,
        } as FunctionArgs<Query>),
  ) as
    | { streams: Extract<SyncStreamsReturnValue, { kind: "list" }> }
    | undefined;
  // Get the cursors for all the active streams
  const cursors = useMemo(() => {
    if (!streamList?.streams) return [];
    if (streamList.streams.kind !== "list") {
      throw new Error("Expected list streams");
    }
    return streamList.streams.messages.map(({ streamId }) => {
      const stream = streams.find((s) => s.streamId === streamId);
      const cursor = stream?.cursor ?? 0;
      return { streamId, cursor };
    });
  }, [streamList, streams]);
  // Get the deltas for all the active streams, if any.
  const cursorQuery = useQuery(
    query,
    queryArgs === "skip" || !streamList
      ? ("skip" as const)
      : ({
          ...queryArgs,
          paginationOpts: { cursor: null, numItems: 0 },
          streamArgs: { kind: "deltas", cursors } as StreamArgs,
        } as FunctionArgs<Query>),
  ) as
    | { streams: Extract<SyncStreamsReturnValue, { kind: "deltas" }> }
    | undefined;
  // Merge any deltas into the streamChunks, keeping it unmodified if unchanged.
  const threadId = args === "skip" ? undefined : args.threadId;
  const [messages, newStreams, changed] = useMemo(() => {
    if (!threadId) return [undefined, [], false];
    if (!streamList) return [undefined, [], false];
    if (cursorQuery && cursorQuery.streams?.kind !== "deltas") {
      throw new Error("Expected deltas streams");
    }
    return mergeDeltas(
      threadId,
      streamList.streams.messages,
      streams,
      cursorQuery?.streams?.deltas ?? [],
    );
  }, [threadId, cursorQuery, streams, streamList]);
  // Now assemble the chunks into messages
  if (!threadId) {
    return undefined;
  }
  if (changed) {
    setStreams(newStreams);
  }
  return messages as ThreadMessagesResult<Query>[] | undefined;
}
