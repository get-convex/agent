import { describe, expect, it } from "vitest";
import { pick } from "convex-helpers";
import { validate } from "convex-helpers/validators";
import {
  type MessageWithMetadataInternal,
  type StreamDelta,
  type StreamMessage,
  vMessageWithMetadataInternal,
} from "../validators.js";
import { deriveUIMessagesFromDeltas } from "../vercel/deltas.js";
import { fromUIMessages } from "../vercel/UIMessages.js";
import {
  getPersistedStreamParts,
  materializeUIMessageChunks,
} from "./materializeUIMessageChunks.js";

const stream: StreamMessage = {
  streamId: "stream-1",
  status: "aborted",
  format: "UIMessageChunk",
  order: 4,
  stepOrder: 1,
  model: "model-1",
  provider: "provider-1",
};

const recoveredFields = [
  "message",
  "fileIds",
  "status",
  "finishReason",
  "model",
  "provider",
  "providerMetadata",
  "sources",
  "reasoning",
  "reasoningDetails",
  "usage",
  "warnings",
  "error",
] as const;

async function materializeWithAiSdk(
  chunks: unknown[],
  metadata: { status: "success" | "failed"; error?: string },
): Promise<MessageWithMetadataInternal[]> {
  const deltas: StreamDelta[] = [
    { streamId: stream.streamId, start: 0, end: 1, parts: chunks },
  ];
  const uiMessages = await deriveUIMessagesFromDeltas(
    "thread-1",
    [stream],
    deltas,
  );
  return (await fromUIMessages(uiMessages, { ...stream, threadId: "thread-1" }))
    .filter((message) => message.message !== undefined)
    .map(
      (message) =>
        ({
          ...pick(message, [...recoveredFields]),
          ...metadata,
        }) as MessageWithMetadataInternal,
    );
}

function expectValidMessages(messages: MessageWithMetadataInternal[]) {
  for (const message of messages) {
    expect(validate(vMessageWithMetadataInternal, message)).toBe(true);
  }
}

describe("materializeUIMessageChunks", () => {
  it("matches AI SDK 6 recovery for text, reasoning, sources, and steps", async () => {
    const chunks = [
      { type: "start-step" },
      {
        type: "reasoning-start",
        id: "reasoning-1",
        providerMetadata: { anthropic: { signature: "start" } },
      },
      {
        type: "reasoning-delta",
        id: "reasoning-1",
        delta: "Think",
        providerMetadata: { anthropic: { signature: "delta" } },
      },
      { type: "reasoning-end", id: "reasoning-1" },
      { type: "text-start", id: "text-1" },
      {
        type: "text-delta",
        id: "text-1",
        delta: "First",
        providerMetadata: { openai: { itemId: "text" } },
      },
      { type: "text-end", id: "text-1" },
      {
        type: "source-document",
        sourceId: "document-1",
        mediaType: "text/plain",
        title: "Document",
        filename: "document.txt",
        providerMetadata: { openai: { source: true } },
      },
      { type: "finish-step" },
      { type: "start-step" },
      { type: "reasoning-start", id: "reasoning-2" },
      { type: "reasoning-delta", id: "reasoning-2", delta: "Again" },
      { type: "reasoning-end", id: "reasoning-2" },
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: "Second" },
      { type: "text-end", id: "text-2" },
    ];
    const metadata = { status: "failed" as const, error: "interrupted" };
    const actual = materializeUIMessageChunks(stream, chunks, metadata);

    expect(actual).toEqual(await materializeWithAiSdk(chunks, metadata));
    expectValidMessages(actual);
  });

  it("matches AI SDK 6 recovery for static and provider-executed tools", async () => {
    const chunks = [
      { type: "start-step" },
      {
        type: "tool-input-start",
        toolCallId: "local-call",
        toolName: "lookup",
      },
      {
        type: "tool-input-available",
        toolCallId: "local-call",
        toolName: "lookup",
        input: { query: "hello" },
        providerMetadata: { openai: { itemId: "local" } },
      },
      {
        type: "tool-output-available",
        toolCallId: "local-call",
        output: { answer: 42 },
      },
      { type: "finish-step" },
      { type: "start-step" },
      {
        type: "tool-input-available",
        toolCallId: "provider-call",
        toolName: "web_search",
        input: { query: "world" },
        providerExecuted: true,
      },
      {
        type: "tool-output-available",
        toolCallId: "provider-call",
        output: "found",
        providerExecuted: true,
      },
    ];
    const metadata = { status: "success" as const };
    const actual = materializeUIMessageChunks(stream, chunks, metadata);

    expect(actual).toEqual(await materializeWithAiSdk(chunks, metadata));
    expectValidMessages(actual);
  });

  it("matches AI SDK 6 recovery for dynamic denial and input errors", async () => {
    const chunks = [
      { type: "start-step" },
      {
        type: "tool-input-available",
        toolCallId: "dynamic-call",
        toolName: "dynamic_lookup",
        input: { query: "hello" },
        dynamic: true,
      },
      {
        type: "tool-approval-request",
        toolCallId: "dynamic-call",
        approvalId: "approval-1",
      },
      { type: "tool-output-denied", toolCallId: "dynamic-call" },
      { type: "finish-step" },
      { type: "start-step" },
      {
        type: "tool-input-start",
        toolCallId: "invalid-call",
        toolName: "strict_tool",
      },
      {
        type: "tool-input-error",
        toolCallId: "invalid-call",
        toolName: "strict_tool",
        input: { invalid: true },
        errorText: "invalid input",
        providerMetadata: { openai: { ignoredOnExistingPart: true } },
      },
    ];
    const metadata = { status: "failed" as const, error: "tool failure" };
    const actual = materializeUIMessageChunks(stream, chunks, metadata);

    expect(actual).toEqual(await materializeWithAiSdk(chunks, metadata));
    expectValidMessages(actual);
  });

  it("materializes multi-step text, reasoning, sources, and provider metadata", () => {
    const messages = materializeUIMessageChunks(
      stream,
      [
        { type: "start-step" },
        { type: "reasoning-start", id: "reasoning-1" },
        {
          type: "reasoning-delta",
          id: "reasoning-1",
          delta: "Think",
          providerMetadata: { openai: { itemId: "reasoning" } },
        },
        { type: "reasoning-end", id: "reasoning-1" },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "First" },
        { type: "text-end", id: "text-1" },
        {
          type: "source-url",
          sourceId: "source-1",
          url: "https://example.com",
          title: "Example",
        },
        { type: "finish-step" },
        { type: "start-step" },
        { type: "text-start", id: "text-2" },
        { type: "text-delta", id: "text-2", delta: "Second" },
        { type: "text-end", id: "text-2" },
      ],
      { status: "failed", error: "interrupted" },
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      status: "failed",
      error: "interrupted",
      finishReason: "stop",
      model: "model-1",
      provider: "provider-1",
      providerMetadata: { openai: { itemId: "reasoning" } },
      reasoning: "Think",
      message: {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Think",
            providerOptions: { openai: { itemId: "reasoning" } },
          },
          { type: "text", text: "First" },
        ],
      },
      sources: [
        {
          type: "source",
          sourceType: "url",
          id: "source-1",
          url: "https://example.com",
          title: "Example",
        },
      ],
    });
    expect(messages[1]).toMatchObject({
      reasoning: "",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Second" }],
      },
      sources: messages[0].sources,
    });
  });

  it("materializes static tool calls and results as assistant and tool messages", () => {
    const messages = materializeUIMessageChunks(
      stream,
      [
        { type: "start-step" },
        {
          type: "tool-input-start",
          toolCallId: "call-1",
          toolName: "lookup",
        },
        {
          type: "tool-input-available",
          toolCallId: "call-1",
          toolName: "lookup",
          input: { query: "hello" },
          providerMetadata: { openai: { itemId: "call" } },
        },
        {
          type: "tool-output-available",
          toolCallId: "call-1",
          output: { answer: 42 },
        },
      ],
      { status: "success" },
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      finishReason: "tool-calls",
      providerMetadata: { openai: { itemId: "call" } },
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
    });
    expect(messages[1]).toMatchObject({
      finishReason: "tool-calls",
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
    });
  });

  it("keeps provider-executed tool results in the assistant message", () => {
    const messages = materializeUIMessageChunks(
      stream,
      [
        {
          type: "tool-input-available",
          toolCallId: "call-1",
          toolName: "search",
          input: { q: "x" },
          providerExecuted: true,
        },
        {
          type: "tool-output-available",
          toolCallId: "call-1",
          output: "found",
          providerExecuted: true,
        },
      ],
      { status: "success" },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toMatchObject({
      role: "assistant",
      content: [
        { type: "tool-call", providerExecuted: true },
        {
          type: "tool-result",
          output: { type: "text", value: "found" },
        },
      ],
    });
  });

  it("returns the same prefix as AI SDK 6 for an orphan continuation result", async () => {
    const chunks = [
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Before" },
      { type: "text-end", id: "text-1" },
      {
        type: "tool-output-available",
        toolCallId: "from-previous-stream",
        output: "ignored",
      },
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: "After" },
    ];
    const metadata = { status: "failed" as const };
    const messages = materializeUIMessageChunks(stream, chunks, metadata);

    expect(messages).toEqual(await materializeWithAiSdk(chunks, metadata));
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Before" }],
    });
  });

  it("rejects malformed text and tool-input delta sequences", () => {
    expect(() =>
      materializeUIMessageChunks(
        stream,
        [{ type: "text-delta", id: "missing", delta: "x" }],
        { status: "failed" },
      ),
    ).toThrow("missing text part");

    expect(() =>
      materializeUIMessageChunks(
        stream,
        [
          {
            type: "tool-input-delta",
            toolCallId: "missing",
            inputTextDelta: "{}",
          },
        ],
        { status: "failed" },
      ),
    ).toThrow("missing tool call");
  });

  it("rejects approval responses outside the pinned AI SDK 6 wire format", () => {
    expect(() =>
      materializeUIMessageChunks(
        stream,
        [
          {
            type: "tool-approval-response",
            approvalId: "approval-1",
            approved: true,
          },
        ],
        { status: "failed" },
      ),
    ).toThrow(
      'persisted chunk type "tool-approval-response" is not part of the pinned AI SDK 6.0.35 UIMessageChunk wire format',
    );
  });

  it("rejects a start chunk that changes the recovered message id", () => {
    expect(() =>
      materializeUIMessageChunks(
        stream,
        [{ type: "start", messageId: "different-message" }],
        { status: "failed" },
      ),
    ).toThrow("only make one UIMessage");

    expect(
      materializeUIMessageChunks(
        stream,
        [{ type: "start", messageId: "stream:stream-1" }],
        { status: "failed" },
      ),
    ).toEqual([]);
  });

  it("reads only the contiguous persisted delta prefix", () => {
    const deltas: StreamDelta[] = [
      {
        streamId: "stream-1",
        start: 2,
        end: 3,
        parts: [{ type: "text-end", id: "text-1" }],
      },
      {
        streamId: "stream-1",
        start: 0,
        end: 2,
        parts: [
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "ok" },
        ],
      },
      {
        streamId: "stream-1",
        start: 5,
        end: 6,
        parts: [{ type: "text-start", id: "after-gap" }],
      },
    ];

    expect(getPersistedStreamParts(deltas)).toMatchObject({
      cursor: 3,
      parts: [
        { type: "text-start" },
        { type: "text-delta" },
        { type: "text-end" },
      ],
    });
  });
});
