"use client";

import type { StreamQuery, StreamQueryArgs } from "./types.js";
import type { SyncStreamsReturnValue } from "../client/types.js";
import type { FunctionArgs } from "convex/server";
import type {
  StreamArgs,
  StreamDelta,
  StreamMessage,
} from "../../validators.js";
import { sorted } from "../../shared.js";
import { useQuery } from "convex/react";
import { useState } from "react";
import { assert } from "convex-helpers";

export function useDeltaStreams<
  Query extends StreamQuery<any> = StreamQuery<object>,
>(
  query: Query,
  args: StreamQueryArgs<Query> | "skip",
  options?: {
    startOrder?: number;
    skipStreamIds?: string[];
  },
): { streamMessage: StreamMessage; deltas: StreamDelta[] }[] | undefined {
  type DeltaStreams =
    | Array<{ streamMessage: StreamMessage; deltas: StreamDelta[] }>
    | undefined;
  const [state, setState] = useState<{
    startOrder: number;
    threadId: string | undefined;
    deltaStreams: DeltaStreams;
    cursors: Record<string, number>;
  }>(() => ({
    startOrder: options?.startOrder ?? 0,
    deltaStreams: undefined,
    threadId: args === "skip" ? undefined : args.threadId,
    cursors: {},
  }));
  // Computed from the previous render's state and committed at the end via a
  // render-phase update, so everything below sees this render's values.
  let { startOrder, threadId, deltaStreams, cursors } = state;
  if (args !== "skip" && threadId !== args.threadId) {
    threadId = args.threadId;
    deltaStreams = undefined;
    startOrder = options?.startOrder ?? 0;
    cursors = {};
  }
  if (
    deltaStreams?.length ||
    (options?.startOrder && options.startOrder < startOrder)
  ) {
    startOrder = options?.startOrder
      ? // round down to the nearest 10 for some cache benefits
        options.startOrder - (options.startOrder % 10)
      : 0;
  }

  // Get all the active streams
  const streamList = useQuery(
    query,
    args === "skip"
      ? args
      : ({
          ...args,
          streamArgs: {
            kind: "list",
            startOrder,
          } as StreamArgs,
        } as FunctionArgs<Query>),
  ) as
    | { streams: Extract<SyncStreamsReturnValue, { kind: "list" }> }
    | undefined;

  const streamMessages =
    args === "skip"
      ? undefined
      : !streamList
        ? deltaStreams?.map(({ streamMessage }) => streamMessage)
        : sorted(
            streamList.streams.messages.filter(
              ({ streamId, order }) =>
                !options?.skipStreamIds?.includes(streamId) &&
                (!options?.startOrder || order >= options.startOrder),
            ),
          );

  // When no active streams remain, clear the stale state so we stop
  // returning old streaming UIMessages.
  if (streamMessages !== undefined && streamMessages.length === 0) {
    deltaStreams = undefined;
  }

  // Get the deltas for all the active streams, if any.
  const cursorQuery = useQuery(
    query,
    args === "skip" || !streamMessages?.length
      ? ("skip" as const)
      : ({
          ...args,
          streamArgs: {
            kind: "deltas",
            cursors: streamMessages.map(({ streamId }) => ({
              streamId,
              cursor: cursors[streamId] ?? 0,
            })),
          } as StreamArgs,
        } as FunctionArgs<Query>),
  ) as
    | { streams: Extract<SyncStreamsReturnValue, { kind: "deltas" }> }
    | undefined;

  const newDeltas = cursorQuery?.streams.deltas;
  if (newDeltas?.length && streamMessages) {
    const newDeltasByStreamId = new Map<string, StreamDelta[]>();
    for (const delta of newDeltas) {
      const oldCursor = cursors[delta.streamId];
      if (oldCursor && delta.start < oldCursor) continue;
      const existing = newDeltasByStreamId.get(delta.streamId);
      if (existing) {
        const previousEnd = existing.at(-1)!.end;
        assert(
          previousEnd === delta.start,
          `Gap found in deltas for ${delta.streamId} jumping to ${delta.start} from ${previousEnd}`,
        );
        existing.push(delta);
      } else {
        assert(
          !oldCursor || oldCursor === delta.start,
          `Gap found - first delta after ${oldCursor} is ${delta.start} for stream ${delta.streamId}`,
        );
        newDeltasByStreamId.set(delta.streamId, [delta]);
      }
    }
    const newCursors: Record<string, number> = {};
    for (const { streamId } of streamMessages) {
      const cursor =
        newDeltasByStreamId.get(streamId)?.at(-1)?.end ?? cursors[streamId];
      if (cursor !== undefined) {
        newCursors[streamId] = cursor;
      }
    }
    cursors = newCursors;

    const previousDeltaStreams = deltaStreams;
    // we defensively create a new object so object identity matches contents
    deltaStreams = streamMessages.map((streamMessage) => {
      const streamId = streamMessage.streamId;
      const old = previousDeltaStreams?.find(
        (ds) => ds.streamMessage.streamId === streamId,
      );
      const newDeltas = newDeltasByStreamId.get(streamId);
      if (!newDeltas && streamMessage === old?.streamMessage) {
        return old;
      }
      return {
        streamMessage,
        deltas: [...(old?.deltas ?? []), ...(newDeltas ?? [])],
      };
    });
  }
  if (
    startOrder !== state.startOrder ||
    threadId !== state.threadId ||
    deltaStreams !== state.deltaStreams ||
    cursors !== state.cursors
  ) {
    setState({ startOrder, threadId, deltaStreams, cursors });
  }
  return deltaStreams;
}
