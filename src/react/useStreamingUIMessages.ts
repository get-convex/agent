"use client";
import { omit } from "convex-helpers";
import { useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useMemo, useState, useEffect } from "react";
import { readUIMessageStream, type UIMessageChunk } from "ai";
import type { SyncStreamsReturnValue } from "../client/types.js";
import type { StreamArgs } from "../validators.js";
import type {
  ThreadStreamQuery,
  ThreadMessagesArgs,
} from "./types.js";
import { type UIMessage } from "./toUIMessages.js";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Query extends ThreadStreamQuery<any, any>,
>(
  query: Query,
  args: (ThreadMessagesArgs<Query> & { startOrder?: number }) | "skip",
): UIMessage[] | undefined {
  const [uiMessages, setUIMessages] = useState<Map<string, UIMessage>>(new Map());
  const [streamCursors, setStreamCursors] = useState<Map<string, number>>(new Map());
  
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
      const cursor = streamCursors.get(streamId) ?? 0;
      return { streamId, cursor };
    });
  }, [streamList, streamCursors]);
  
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

  // Process new deltas and convert to UIMessageChunks, then use readUIMessageStream
  useEffect(() => {
    if (!cursorQuery?.streams?.deltas) return;
    
    const deltasByStream = new Map<string, typeof cursorQuery.streams.deltas>();
    
    // Group deltas by streamId
    for (const delta of cursorQuery.streams.deltas) {
      if (!deltasByStream.has(delta.streamId)) {
        deltasByStream.set(delta.streamId, []);
      }
      deltasByStream.get(delta.streamId)!.push(delta);
    }
    
    // Process each stream's deltas
    for (const [streamId, deltas] of deltasByStream.entries()) {
      const currentCursor = streamCursors.get(streamId) ?? 0;
      
      // Filter to new deltas only
      const newDeltas = deltas.filter(delta => delta.start >= currentCursor);
      if (newDeltas.length === 0) continue;
      
      // Convert deltas to UIMessageChunks
      const chunks: UIMessageChunk[] = [];
      for (const delta of newDeltas.sort((a, b) => a.start - b.start)) {
        chunks.push(...delta.parts);
      }
      
      if (chunks.length === 0) continue;
      
      // Create ReadableStream from chunks
      const stream = new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        }
      });
      
      // Get existing message for this stream as starting point
      const existingMessage = uiMessages.get(streamId);
      
      // Use readUIMessageStream to process the chunks
      const messageStream = readUIMessageStream({
        message: existingMessage,
        stream,
        onError: (error) => {
          console.error(`Error in stream ${streamId}:`, error);
        },
        terminateOnError: false,
      });
      
      // Process the async iterator
      (async () => {
        try {
          for await (const message of messageStream) {
            setUIMessages(prev => {
              const newMap = new Map(prev);
              
              // If the message ID changed, this represents a new message
              if (existingMessage && message.id !== existingMessage.id) {
                // Keep the old message and add the new one
                newMap.set(`${streamId}-${message.id}`, message as UIMessage);
              } else {
                // Update the existing message
                newMap.set(streamId, message as UIMessage);
              }
              
              return newMap;
            });
          }
        } catch (error) {
          console.error(`Error processing stream ${streamId}:`, error);
        }
      })();
      
      // Update cursor for this stream
      const maxCursor = Math.max(...newDeltas.map(d => d.end));
      setStreamCursors(prev => new Map(prev).set(streamId, maxCursor));
    }
  }, [cursorQuery, streamCursors, uiMessages]);

  // Clean up finished streams
  useEffect(() => {
    if (!streamList?.streams?.messages) return;
    
    const activeStreamIds = new Set(streamList.streams.messages.map(m => m.streamId));
    
    setUIMessages(prev => {
      const newMap = new Map();
      for (const [key, message] of prev.entries()) {
        // Keep messages for active streams or compound keys (streamId-messageId)
        if (activeStreamIds.has(key) || key.includes('-')) {
          newMap.set(key, message);
        }
      }
      return newMap;
    });
    
    setStreamCursors(prev => {
      const newMap = new Map();
      for (const [streamId, cursor] of prev.entries()) {
        if (activeStreamIds.has(streamId)) {
          newMap.set(streamId, cursor);
        }
      }
      return newMap;
    });
  }, [streamList]);

  return useMemo(() => {
    if (uiMessages.size === 0) return undefined;
    
    // Convert map to array and sort by order/stepOrder
    return Array.from(uiMessages.values()).sort((a, b) => 
      a.order === b.order ? a.stepOrder - b.stepOrder : a.order - b.order
    );
  }, [uiMessages]);
}