"use client";
import { useMemo, useState, useEffect } from "react";
import { type UIDataTypes, type UIMessageChunk, type UITools } from "ai";
import type { StreamQuery, StreamQueryArgs } from "./types.js";
import { type UIMessage } from "../UIMessages.js";
import {
  applyUIMessageChunksIncremental,
  blankUIMessage,
  emptyIncrementalStreamState,
  getParts,
  statusFromStreamStatus,
  deriveUIMessagesFromTextStreamParts,
  type IncrementalStreamState,
} from "../deltas.js";
import { useDeltaStreams } from "./useDeltaStreams.js";

// Polyfill structuredClone to support readUIMessageStream on ReactNative
if (!("structuredClone" in globalThis)) {
  void import("@ungap/structured-clone" as any).then(
    ({ default: structuredClone }) =>
      (globalThis.structuredClone = structuredClone),
  );
}

/**
 * A hook that fetches streaming messages from a thread and converts them to UIMessages
 * using AI SDK's readUIMessageStream.
 * This ONLY returns streaming UIMessages. To get both full and streaming messages,
 * use `useUIMessages`.
 *
 * @param query The query to use to fetch messages.
 * It must take as arguments `{ threadId, paginationOpts, streamArgs }` and
 * return a `streams` object returned from `agent.syncStreams`.
 * @param args The arguments to pass to the query other than `paginationOpts`
 * and `streamArgs`. So `{ threadId }` at minimum, plus any other arguments that
 * you want to pass to the query.
 * @returns The streaming UIMessages.
 */
export function useStreamingUIMessages<
  METADATA = unknown,
  DATA_PARTS extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
  Query extends StreamQuery<any> = StreamQuery<object>,
>(
  query: Query,
  args: StreamQueryArgs<Query> | "skip",
  options?: {
    startOrder?: number;
    skipStreamIds?: string[];
  },
  // TODO: make generic on metadata, etc.
): UIMessage<METADATA, DATA_PARTS, TOOLS>[] | undefined {
  const [messageState, setMessageState] = useState<
    Record<
      string,
      {
        uiMessage: UIMessage<METADATA, DATA_PARTS, TOOLS>;
        cursor: number;
        streamState: IncrementalStreamState;
      }
    >
  >({});

  const streams = useDeltaStreams(query, args, options);

  const threadId = args === "skip" ? undefined : args.threadId;

  useEffect(() => {
    if (!streams) return;
    let noNewDeltas = true;
    for (const stream of streams) {
      const existingStreamState = messageState[stream.streamMessage.streamId];
      const lastDelta = stream.deltas.at(-1);
      const cursor = existingStreamState?.cursor;
      if (existingStreamState === undefined || cursor === undefined) {
        noNewDeltas = false;
        break;
      }
      if (lastDelta && lastDelta.start >= cursor) {
        noNewDeltas = false;
        break;
      }
      if (
        existingStreamState &&
        existingStreamState.uiMessage.status !==
          statusFromStreamStatus(stream.streamMessage.status)
      ) {
        noNewDeltas = false;
        break;
      }
    }
    if (noNewDeltas) {
      return;
    }
    const abortController = new AbortController();
    void (async () => {
      const newMessageState: Record<
        string,
        {
          uiMessage: UIMessage<METADATA, DATA_PARTS, TOOLS>;
          cursor: number;
          streamState: IncrementalStreamState;
        }
      > = Object.fromEntries(
        await Promise.all(
          streams.map(async ({ deltas, streamMessage }) => {
            const streamId = streamMessage.streamId;
            const existing = messageState[streamId];
            const fromCursor = existing?.cursor ?? 0;
            const status = statusFromStreamStatus(streamMessage.status);
            const prevState =
              existing?.streamState ?? emptyIncrementalStreamState();

            if (streamMessage.format !== "UIMessageChunk") {
              const existingStreams = existing
                ? [
                    {
                      streamId,
                      cursor: existing.cursor,
                      message: existing.uiMessage as UIMessage,
                    },
                  ]
                : [];
              const [uiMessages, newStreams] =
                deriveUIMessagesFromTextStreamParts(
                  threadId as string,
                  [streamMessage],
                  existingStreams,
                  deltas,
                );
              return [
                streamId,
                {
                  uiMessage: (uiMessages[0] ?? existing?.uiMessage) as UIMessage<
                    METADATA,
                    DATA_PARTS,
                    TOOLS
                  >,
                  cursor: newStreams[0]?.cursor ?? fromCursor,
                  streamState: prevState,
                },
              ];
            }

            const { parts: newParts, cursor } = getParts<UIMessageChunk>(
              deltas,
              fromCursor,
            );

            const base =
              existing?.uiMessage ??
              blankUIMessage(streamMessage, threadId as string);

            if (newParts.length === 0) {
              if (existing && existing.uiMessage.status !== status) {
                return [
                  streamId,
                  {
                    uiMessage: { ...existing.uiMessage, status },
                    cursor: existing.cursor,
                    streamState: prevState,
                  },
                ];
              }
              return [
                streamId,
                existing ?? { uiMessage: base, cursor: 0, streamState: prevState },
              ];
            }

            const { message, streamState } = applyUIMessageChunksIncremental(
              base as UIMessage,
              newParts,
              prevState,
            );
            message.status = status;
            return [
              streamId,
              {
                uiMessage: message as UIMessage<METADATA, DATA_PARTS, TOOLS>,
                cursor,
                streamState,
              },
            ];
          }),
        ),
      );
      if (abortController.signal.aborted) return;
      setMessageState(newMessageState);
    })();
    return () => {
      abortController.abort();
    };
  }, [messageState, streams, threadId]);

  return useMemo(() => {
    if (!streams) return undefined;
    return streams
      .map(
        ({ streamMessage }) => messageState[streamMessage.streamId]?.uiMessage,
      )
      .filter((uiMessage) => uiMessage !== undefined);
  }, [messageState, streams]);
}
