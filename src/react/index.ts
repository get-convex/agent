"use client";
import { omit, type ErrorMessage } from "convex-helpers";
import {
  type PaginatedQueryArgs,
  type UsePaginatedQueryResult,
  useQuery,
} from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import type { FunctionArgs } from "convex/server";
import { useMemo, useRef, useState } from "react";
import type { MessageDoc } from "../client/index.js";
import type { SyncStreamsReturnValue } from "../client/types.js";
import type { StreamArgs } from "../validators.js";
import type { UIMessage } from "./toUIMessages.js";
import { toUIMessages } from "./toUIMessages.js";
import { mergeDeltas } from "./deltas.js";
import type {
  ThreadQuery,
  ThreadStreamQuery,
  ThreadMessagesArgs,
  ThreadMessagesResult,
} from "./types.js";

export { optimisticallySendMessage } from "./optimisticallySendMessage.js";
export { useSmoothText } from "./useSmoothText.js";
export { toUIMessages, type UIMessage };

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
    stream?: Query extends ThreadStreamQuery
      ? boolean
      : ErrorMessage<"To enable streaming, your query must take in streamArgs: vStreamArgs and return a streams object returned from agent.syncStreams. See docs.">;
  }
): UsePaginatedQueryResult<
  ThreadMessagesResult<Query> & { streaming?: boolean }
> {
  // These are full messages
  const paginated = usePaginatedQuery(
    query,
    args as PaginatedQueryArgs<Query> | "skip",
    { initialNumItems: options.initialNumItems }
  );

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
      : { ...args, startOrder: paginated.results.at(-1)?.order }
  );

  const merged = useMemo(() => {
    const streamListMessages =
      streamMessages?.map((m) => ({
        ...m,
        streaming: !m.status || m.status === "streaming",
      })) ?? [];
    return {
      ...paginated,
      results: paginated.results
        .map((m) => ({ ...m, streaming: false }))
        .concat(streamListMessages)
        .sort((a, b) =>
          a.order === b.order ? a.stepOrder - b.stepOrder : a.order - b.order
        )
        // They shouldn't overlap, but check for duplicates just in case.
        .filter(
          (m, i, arr) =>
            !arr[i - 1] ||
            m.order !== arr[i - 1].order ||
            m.stepOrder !== arr[i - 1].stepOrder
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
  args: (ThreadMessagesArgs<Query> & { startOrder?: number }) | "skip"
): Array<ThreadMessagesResult<Query>> | undefined {
  // Invariant: streamMessages[streamId] is comprised of all deltas up to the
  // cursor. There can be multiple messages in the same stream, e.g. for tool
  // calls.
  const [streams, setStreams] = useState<
    Array<{ streamId: string; cursor: number; messages: MessageDoc[] }>
  >([]);
  const startOrderRef = useRef<number>(0);
  const queryArgs = args === "skip" ? args : omit(args, ["startOrder"]);
  if (args !== "skip" && !startOrderRef.current && args.startOrder) {
    startOrderRef.current = args.startOrder;
  }
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
            startOrder: startOrderRef.current,
          } as StreamArgs,
        } as FunctionArgs<Query>)
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
        } as FunctionArgs<Query>)
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
      cursorQuery?.streams?.deltas ?? []
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

/**
 * @deprecated use useThreadMessages or useStreamingThreadMessages instead
 * Use this hook to stream text from a server action, using the
 * toTextStreamResponse or equivalent HTTP streaming endpoint returning text.
 * @param url The URL of the server action to stream text from.
 *   e.g. https://....convex.site/yourendpoint
 * @param threadId The ID of the thread to stream text from.
 * @param token The auth token to use for the request.
 *   e.g. useAuthToken() from @convex-dev/auth/react
 * @returns A tuple containing the {text, loading, error} and a function to call the endpoint
 * with a given prompt, passing up { prompt, threadId } as the body in JSON.
 */
export function useStreamingText(
  url: string,
  threadId: string | null,
  token?: string
) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const readStream = useMemo(
    () => async (prompt: string) => {
      if (!threadId) return;
      try {
        setText("");
        setLoading(true);
        setError(null);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ prompt, threadId }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        if (!response.body) {
          throw new Error("No body");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          accumulatedText += decoder.decode(value);
          setText(accumulatedText);
        }
      } catch (e) {
        if (e instanceof Error && e.name !== "AbortError") {
          setError(e);
        }
      } finally {
        setLoading(false);
      }
    },
    [threadId, token, url]
  );
  return [{ text, loading, error }, readStream] as const;
}
