"use client";
import { useCallback, useRef, useState } from "react";
import { consumeTextStream } from "./httpStreamUtils.js";

/**
 * React hook for consuming an HTTP text stream from a Convex HTTP action.
 *
 * Returns `streamId` and `messageId` from response headers so you can
 * pass them to `useUIMessages` via `skipStreamIds` for deduplication.
 *
 * @example
 * ```tsx
 * const httpStream = useHttpStream({ url: `${siteUrl}/chat` });
 * const messages = useUIMessages(api.chat.listMessages, { threadId }, {
 *   stream: true,
 *   skipStreamIds: httpStream.streamId ? [httpStream.streamId] : [],
 * });
 *
 * await httpStream.send({ threadId, prompt: "Hello!" });
 * ```
 */
export function useHttpStream(options: {
  /** The full URL of the HTTP streaming endpoint. */
  url: string;
  /**
   * Auth token to send as `Authorization: Bearer <token>`.
   * e.g. from `useAuthToken()` via `@convex-dev/auth/react`.
   */
  token?: string;
  /** Additional headers to include in the request. */
  headers?: Record<string, string>;
}): {
  text: string;
  isStreaming: boolean;
  error: Error | null;
  streamId: string | null;
  messageId: string | null;
  send: (body: {
    threadId?: string;
    prompt?: string;
    [key: string]: unknown;
  }) => Promise<void>;
  abort: () => void;
} {
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Each call to send() bumps this; only the latest request is allowed
  // to flip the streaming/error/text state in its finally block.
  const requestIdRef = useRef(0);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const send = useCallback(
    async (body: {
      threadId?: string;
      prompt?: string;
      [key: string]: unknown;
    }) => {
      // Abort any existing stream
      abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const requestId = ++requestIdRef.current;

      setText("");
      setError(null);
      setStreamId(null);
      setMessageId(null);
      setIsStreaming(true);

      try {
        const response = await fetch(options.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(options.token
              ? { Authorization: `Bearer ${options.token}` }
              : {}),
            ...options.headers,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseStreamId = response.headers.get("X-Stream-Id");
        const responseMessageId = response.headers.get("X-Message-Id");
        if (requestId === requestIdRef.current) {
          if (responseStreamId) setStreamId(responseStreamId);
          if (responseMessageId) setMessageId(responseMessageId);
        }

        if (!response.body) {
          throw new Error("Response body is not readable");
        }

        const reader = response.body.getReader();
        let accumulated = "";

        await consumeTextStream(reader, {
          onChunk: (chunk) => {
            // Stale chunks from a superseded request must not bleed into
            // the current view.
            if (requestId !== requestIdRef.current) return;
            accumulated += chunk;
            setText(accumulated);
          },
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          return;
        }
        if (requestId === requestIdRef.current) {
          const err = e instanceof Error ? e : new Error(String(e));
          setError(err);
        }
      } finally {
        // Only the latest send() should flip streaming state. Otherwise a
        // stale request that finishes after a newer one has started would
        // mark the live stream as finished.
        if (requestId === requestIdRef.current) {
          setIsStreaming(false);
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [options.url, options.token, options.headers, abort],
  );

  return { text, isStreaming, error, streamId, messageId, send, abort };
}
