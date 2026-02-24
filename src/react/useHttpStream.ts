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
 * // Send a message
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
  /** The accumulated text received so far. */
  text: string;
  /** Whether a stream is currently active. */
  isStreaming: boolean;
  /** The last error encountered, if any. */
  error: Error | null;
  /**
   * The delta stream ID from the `X-Stream-Id` response header.
   * Pass to `skipStreamIds` on `useUIMessages` to avoid duplicating
   * this stream's content.
   */
  streamId: string | null;
  /** The prompt message ID from the `X-Message-Id` response header. */
  messageId: string | null;
  /**
   * Send a request to the streaming endpoint.
   * The body is JSON-serialized and sent as a POST request.
   */
  send: (body: {
    threadId?: string;
    prompt?: string;
    [key: string]: unknown;
  }) => Promise<void>;
  /** Abort the current stream, if any. */
  abort: () => void;
} {
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

        // Extract metadata headers
        const responseStreamId = response.headers.get("X-Stream-Id");
        const responseMessageId = response.headers.get("X-Message-Id");
        if (responseStreamId) setStreamId(responseStreamId);
        if (responseMessageId) setMessageId(responseMessageId);

        if (!response.body) {
          throw new Error("Response body is not readable");
        }

        const reader = response.body.getReader();
        let accumulated = "";

        await consumeTextStream(reader, {
          onChunk: (chunk) => {
            accumulated += chunk;
            setText(accumulated);
          },
          signal: controller.signal,
        });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          // Intentional abort — not an error
          return;
        }
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
      } finally {
        setIsStreaming(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [options.url, options.token, options.headers, abort],
  );

  return { text, isStreaming, error, streamId, messageId, send, abort };
}
