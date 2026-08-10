import { describe, expect, it } from "vitest";
import {
  createPersistedUIMessageChunkState,
  reducePersistedUIMessageChunks,
} from "./persistedUIMessageChunks.js";

describe("reducePersistedUIMessageChunks", () => {
  it("carries durable reducer state across persisted batches", () => {
    const first = reducePersistedUIMessageChunks(
      createPersistedUIMessageChunkState(),
      [
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "partial" },
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "lookup" },
        {
          type: "tool-input-delta",
          toolCallId: "tool-1",
          inputTextDelta: '{"query":',
        },
      ],
    );
    const second = reducePersistedUIMessageChunks(first.state, [
      { type: "text-delta", id: "text-1", delta: " answer" },
      { type: "text-end", id: "text-1" },
      {
        type: "tool-input-delta",
        toolCallId: "tool-1",
        inputTextDelta: '"ok"}',
      },
    ]);

    expect(second.state.parts).toMatchObject([
      { type: "text", text: "partial answer", state: "done" },
      { type: "tool-lookup", toolCallId: "tool-1", state: "input-streaming" },
    ]);
    expect(second.state.toolInputText.get("tool-1")).toBe('{"query":"ok"}');
    expect(second.touchedToolCallIds).toEqual(["tool-1"]);
  });

  it("accepts metadata-only lifecycle chunks without materializing parts", () => {
    const reduced = reducePersistedUIMessageChunks(
      createPersistedUIMessageChunkState(),
      [
        { type: "start", messageMetadata: { source: "start" } },
        { type: "message-metadata", messageMetadata: { source: "update" } },
        { type: "finish", messageMetadata: { source: "finish" } },
      ],
    );

    expect(reduced.state.parts).toEqual([]);
  });
});
