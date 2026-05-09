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
    controller.abort();

    const stream = makeReadableStream(["first ", "second"]);

    await consumeTextStream(stream.getReader(), {
      onChunk: (text) => chunks.push(text),
      signal: controller.signal,
    });

    expect(chunks).toEqual([]);
  });

  test("aborting mid-stream cancels a pending read", async () => {
    // Stream that never enqueues — reader.read() will hang until cancel.
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // intentionally idle
      },
    });
    const controller = new AbortController();
    const chunks: string[] = [];

    const consume = consumeTextStream(stream.getReader(), {
      onChunk: (text) => chunks.push(text),
      signal: controller.signal,
    });

    // Abort while consumeTextStream is blocked on reader.read()
    setTimeout(() => controller.abort(), 10);

    await consume; // Should resolve, not hang
    expect(chunks).toEqual([]);
  });

  test("handles multi-byte UTF-8 characters split across chunks", async () => {
    const emoji = new Uint8Array([0xf0, 0x9f, 0x98, 0x80]);
    const chunks: string[] = [];

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(emoji.slice(0, 2));
        ctrl.enqueue(emoji.slice(2, 4));
        ctrl.close();
      },
    });

    await consumeTextStream(stream.getReader(), {
      onChunk: (text) => chunks.push(text),
    });

    expect(chunks.join("")).toContain("\u{1F600}");
  });
});

describe("supportsStreaming", () => {
  test("returns true in environments with ReadableStream and fetch", () => {
    expect(supportsStreaming()).toBe(true);
  });
});
