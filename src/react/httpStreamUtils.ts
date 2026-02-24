/**
 * Consume a ReadableStream of Uint8Array chunks, decoding them as text
 * and calling `onChunk` for each decoded segment.
 *
 * Handles multi-byte characters correctly using `TextDecoder({ stream: true })`.
 */
export async function consumeTextStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: {
    onChunk: (text: string) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const decoder = new TextDecoder();

  try {
    while (true) {
      if (options.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      options.onChunk(text);
    }
    // Flush any remaining bytes in the decoder
    const remaining = decoder.decode();
    if (remaining) {
      options.onChunk(remaining);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Returns `true` when running in a browser that supports
 * `ReadableStream` on `Response.body`. Returns `false` during SSR
 * or in environments where streaming fetch is unavailable.
 */
export function supportsStreaming(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.ReadableStream !== "undefined" &&
    typeof globalThis.fetch !== "undefined"
  );
}
