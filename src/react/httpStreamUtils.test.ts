import { describe, expect, test } from "vitest";
import { consumeTextStream, supportsStreaming } from "./httpStreamUtils.js";

function makeReadableStream(
  chunks: string[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("consumeTextStream", () => {
  test("decodes chunks and calls onChunk", async () => {
    const chunks: string[] = [];
    const stream = makeReadableStream(["Hello ", "world", "!"]);
    await consumeTextStream(stream.getReader(), {
      onChunk: (text) => chunks.push(text),
    });
    expect(chunks).toEqual(["Hello ", "world", "!"]);
  });

  test("handles empty stream", async () => {
    const chunks: string[] = [];
    const stream = makeReadableStream([]);
    await consumeTextStream(stream.getReader(), {
      onChunk: (text) => chunks.push(text),
    });
    expect(chunks).toEqual([]);
  });

  test("handles single large chunk", async () => {
    const longText = "A".repeat(10000);
    const chunks: string[] = [];
    const stream = makeReadableStream([longText]);
    await consumeTextStream(stream.getReader(), {
      onChunk: (text) => chunks.push(text),
    });
    expect(chunks.join("")).toBe(longText);
  });

  test("stops when abort signal is already aborted", async () => {
    const chunks: string[] = [];
    const controller = new AbortController();
    // Abort before consuming
    controller.abort();

    const stream = makeReadableStream(["first ", "second"]);

    await consumeTextStream(stream.getReader(), {
      onChunk: (text) => chunks.push(text),
      signal: controller.signal,
    });

    // Should not consume any chunks since signal is already aborted
    expect(chunks).toEqual([]);
  });

  test("handles multi-byte UTF-8 characters split across chunks", async () => {
    // The emoji "😀" is 4 bytes in UTF-8: F0 9F 98 80
    const emoji = new Uint8Array([0xf0, 0x9f, 0x98, 0x80]);
    const chunks: string[] = [];

    // Split the emoji across two chunks
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(emoji.slice(0, 2)); // First 2 bytes
        ctrl.enqueue(emoji.slice(2, 4)); // Last 2 bytes
        ctrl.close();
      },
    });

    await consumeTextStream(stream.getReader(), {
      onChunk: (text) => chunks.push(text),
    });

    // TextDecoder with stream: true handles this correctly
    // First chunk produces empty string (incomplete character)
    // Second chunk produces the full emoji + flush produces nothing
    expect(chunks.join("")).toContain("\u{1F600}");
  });
});

describe("supportsStreaming", () => {
  test("returns true in browser-like environment", () => {
    // Node test environment has ReadableStream and fetch
    expect(supportsStreaming()).toBe(true);
  });
});
