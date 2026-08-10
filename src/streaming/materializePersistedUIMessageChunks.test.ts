import { describe, expect, it } from "vitest";
import { validate } from "convex-helpers/validators";
import {
  type StreamDelta,
  type StreamMessage,
  vMessageWithMetadataInternal,
} from "../validators.js";
import {
  getPersistedUIMessageChunkParts,
  projectPersistedUIMessageChunks,
} from "./materializePersistedUIMessageChunks.js";

const stream: StreamMessage = {
  streamId: "stream-1",
  status: "aborted",
  format: "UIMessageChunk",
  order: 4,
  stepOrder: 1,
  model: "model-1",
  provider: "provider-1",
};

describe("projectPersistedUIMessageChunks", () => {
  it("keeps persisted sources on the step that produced them", () => {
    const chunks = [
      { type: "start-step" },
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", delta: "Think" },
      { type: "reasoning-end", id: "reasoning-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Answer" },
      { type: "text-end", id: "text-1" },
      {
        type: "source-url",
        sourceId: "source-1",
        url: "https://example.com",
        title: "Example",
      },
      { type: "finish-step" },
      { type: "start-step" },
      {
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "lookup",
        input: { query: "hello" },
      },
      {
        type: "tool-output-available",
        toolCallId: "call-1",
        output: { answer: 42 },
      },
    ];
    const metadata = { status: "failed" as const, error: "interrupted" };

    const actual = projectPersistedUIMessageChunks(stream, chunks, metadata);
    expect(actual).toEqual([
      {
        message: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Think" },
            { type: "text", text: "Answer" },
          ],
        },
        status: "failed",
        finishReason: "stop",
        model: "model-1",
        provider: "provider-1",
        sources: [
          {
            type: "source",
            sourceType: "url",
            url: "https://example.com",
            id: "source-1",
            title: "Example",
          },
        ],
        reasoning: "Think",
        error: "interrupted",
      },
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookup",
              input: { query: "hello" },
              args: { query: "hello" },
            },
          ],
        },
        status: "failed",
        finishReason: "tool-calls",
        model: "model-1",
        provider: "provider-1",
        sources: [],
        reasoning: "",
        error: "interrupted",
      },
      {
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "lookup",
              output: { type: "json", value: { answer: 42 } },
            },
          ],
        },
        status: "failed",
        finishReason: "tool-calls",
        model: "model-1",
        provider: "provider-1",
        sources: [],
        reasoning: "",
        error: "interrupted",
      },
    ]);
    for (const message of actual) {
      expect(validate(vMessageWithMetadataInternal, message)).toBe(true);
    }
  });

  it("uses only the contiguous persisted prefix and rejects malformed lifecycle bytes", () => {
    const deltas: StreamDelta[] = [
      {
        streamId: stream.streamId,
        start: 1,
        end: 2,
        parts: [{ type: "text-end", id: "text-1" }],
      },
      {
        streamId: stream.streamId,
        start: 3,
        end: 4,
        parts: [{ type: "text-end", id: "after-gap" }],
      },
      {
        streamId: stream.streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-start", id: "text-1" }],
      },
    ];
    expect(getPersistedUIMessageChunkParts(deltas)).toMatchObject({
      cursor: 2,
    });
    expect(() =>
      getPersistedUIMessageChunkParts([
        {
          streamId: stream.streamId,
          start: 0,
          end: 2,
          parts: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "partial" },
          ],
        },
        {
          streamId: stream.streamId,
          start: 1,
          end: 3,
          parts: [
            { type: "text-delta", id: "text-1", delta: "overlap" },
            { type: "text-end", id: "text-1" },
          ],
        },
      ]),
    ).toThrow("Got unexpected delta");
    expect(() =>
      projectPersistedUIMessageChunks(
        stream,
        [{ type: "text-delta", id: "missing", delta: "partial" }],
        { status: "failed" },
      ),
    ).toThrow("missing text part");
  });

  it("replaces provider metadata and projects file metadata", () => {
    const chunks = [
      {
        type: "text-start",
        id: "text-1",
        providerMetadata: { openai: { phase: "start" } },
      },
      {
        type: "text-delta",
        id: "text-1",
        delta: "answer",
        providerMetadata: { anthropic: { phase: "delta" } },
      },
      {
        type: "text-end",
        id: "text-1",
        providerMetadata: { openai: { phase: "end" } },
      },
      {
        type: "file",
        url: "https://example.com/file.txt",
        mediaType: "text/plain",
        providerMetadata: { openai: { ignored: true } },
      },
    ];
    const metadata = { status: "failed" as const };
    const actual = projectPersistedUIMessageChunks(stream, chunks, metadata);

    expect(actual).toEqual([
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "answer",
              providerOptions: { openai: { phase: "end" } },
            },
            {
              type: "file",
              data: "https://example.com/file.txt",
              mediaType: "text/plain",
            },
          ],
        },
        status: "failed",
        finishReason: "stop",
        model: "model-1",
        provider: "provider-1",
        providerMetadata: { openai: { phase: "end" } },
        sources: [],
        reasoning: "",
      },
    ]);
  });

  it("accepts persisted data-* chunks without losing recovered text", () => {
    const chunks = [
      { type: "data-progress", id: "progress-1", data: { completed: 1 } },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "recovered" },
      { type: "text-end", id: "text-1" },
      { type: "data-progress", id: "progress-1", data: { completed: 2 } },
    ];
    const metadata = { status: "failed" as const };
    const actual = projectPersistedUIMessageChunks(stream, chunks, metadata);

    expect(actual).toEqual([
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "recovered" }],
        },
        status: "failed",
        finishReason: "stop",
        model: "model-1",
        provider: "provider-1",
        sources: [],
        reasoning: "",
      },
    ]);
  });

  it("normalizes malformed tool input through durable recovery", () => {
    const chunks = [
      {
        type: "tool-input-error",
        toolCallId: "call-invalid",
        toolName: "lookup",
        errorText: "invalid tool input",
      },
    ];
    const metadata = { status: "failed" as const };
    const actual = projectPersistedUIMessageChunks(stream, chunks, metadata);

    expect(actual).toEqual([
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-invalid",
              toolName: "lookup",
              input: {},
              args: {},
            },
          ],
        },
        status: "failed",
        finishReason: "tool-calls",
        model: "model-1",
        provider: "provider-1",
        sources: [],
        reasoning: "",
      },
      {
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-invalid",
              toolName: "lookup",
              output: { type: "error-text", value: "invalid tool input" },
            },
          ],
        },
        status: "failed",
        finishReason: "tool-calls",
        model: "model-1",
        provider: "provider-1",
        sources: [],
        reasoning: "",
      },
    ]);
  });
});
