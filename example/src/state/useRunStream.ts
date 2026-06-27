import { handleHttpStream } from "@convex-dev/stream";
import {
  startTransition,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";

import { userFacingError } from "../lib/format";
import type { AgentRun, AgentRunEvent, StreamState } from "./types";

const maxActivityChunks = 32;

type RunStatus = { status: string };

type Action =
  | { type: "reset" }
  | { type: "begin"; run: AgentRun }
  | { type: "chunks"; chunks: string[] }
  | { type: "statusChunk"; status: RunStatus; terminal: boolean }
  | { type: "error"; message: string }
  | { type: "fatalError"; message: string }
  | { type: "close" };

const idleState: StreamState = { state: "idle", headers: {}, chunks: [] };

function appendChunks(stream: StreamState, chunks: string[]): string[] {
  return [...stream.chunks, ...chunks].slice(-maxActivityChunks);
}

function isTerminalStatus(status: string) {
  return status === "success" || status === "failed" || status === "canceled";
}

function reducer(state: StreamState, action: Action): StreamState {
  switch (action.type) {
    case "reset":
      return idleState;
    case "begin":
      return {
        state: "connecting",
        headers: {
          "X-Agent-Run-Id": action.run.runId,
          "X-Agent-Thread-Id": action.run.threadId,
          "X-Agent-Message-Id": action.run.messageId ?? "",
          "X-Stream-Id": action.run.streamId,
        },
        chunks: [],
      };
    case "chunks":
      return {
        ...state,
        state: "live",
        chunks: appendChunks(state, action.chunks),
      };
    case "statusChunk":
      return {
        ...state,
        state: action.terminal ? "closed" : state.state,
        chunks: appendChunks(state, [
          JSON.stringify({ type: "status", status: action.status }, null, 2),
        ]),
      };
    case "error":
      return { ...state, state: "error", error: action.message };
    case "fatalError":
      return { state: "error", headers: {}, chunks: [], error: action.message };
    case "close":
      return { ...state, state: state.state === "error" ? "error" : "closed" };
    default:
      return state;
  }
}

export function useRunStream(siteUrl: string | undefined, sessionId: string) {
  const [stream, dispatch] = useReducer(reducer, idleState);
  const abortRef = useRef<AbortController | null>(null);
  const pendingChunksRef = useRef<string[]>([]);
  const frameRef = useRef<number | null>(null);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const flushPending = useCallback(() => {
    frameRef.current = null;
    const chunks = pendingChunksRef.current;
    pendingChunksRef.current = [];
    if (chunks.length > 0) {
      startTransition(() => {
        dispatch({ type: "chunks", chunks });
      });
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => flushPending());
  }, [flushPending]);

  const resetStream = useCallback(() => {
    abortRef.current?.abort();
    cancelFrame();
    pendingChunksRef.current = [];
    dispatch({ type: "reset" });
  }, [cancelFrame]);

  const readStream = useCallback(
    async (run: AgentRun) => {
      if (!siteUrl) {
        dispatch({
          type: "fatalError",
          message: "Missing VITE_CONVEX_SITE_URL and could not infer one.",
        });
        return;
      }

      abortRef.current?.abort();
      cancelFrame();
      pendingChunksRef.current = [];

      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "begin", run });

      const url = new URL("/agent/run", siteUrl);
      url.searchParams.set("runId", run.runId);
      url.searchParams.set("sessionId", sessionId);
      const connection = handleHttpStream<AgentRunEvent>({
        url,
        cursor: null,
        signal: controller.signal,
        onEvents(events) {
          pendingChunksRef.current.push(
            JSON.stringify({ type: "events", events }, null, 2),
          );
          scheduleFlush();
        },
        onStatus(status) {
          startTransition(() => {
            dispatch({
              type: "statusChunk",
              status,
              terminal: isTerminalStatus(status.status),
            });
          });
        },
        onError(error) {
          if (controller.signal.aborted) return;
          dispatch({ type: "error", message: userFacingError(error) });
        },
      });

      try {
        await connection.closed;
      } catch (error) {
        if (controller.signal.aborted) return;
        dispatch({ type: "error", message: userFacingError(error) });
        return;
      }
      if (!controller.signal.aborted) {
        if (frameRef.current !== null) {
          cancelFrame();
          flushPending();
        }
        dispatch({ type: "close" });
      }
    },
    [sessionId, flushPending, scheduleFlush, siteUrl, cancelFrame],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
      cancelFrame();
    },
    [cancelFrame],
  );

  return { readStream, resetStream, stream };
}
