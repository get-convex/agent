import type { UIMessage, UIMessageChunk } from "ai";
import type { FunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import type { AgentRun } from "../../src/client/index.js";
import type { AgentRunEventRead } from "../../src/client/runEvents.js";
import type { AgentMessageDoc, AgentMessageInput } from "../../src/validators.js";
import {
  createChatTransport,
  type AgentChat,
} from "../../src/vercel/react.js";

async function readChunks(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return chunks;
    }
    chunks.push(value);
  }
}

describe("@convex-dev/agent/vercel/react", () => {
  test("starts a run with a Convex mutation and streams events from watchQuery", async () => {
    const run = fakeRun();
    const read = fakeRead();
    const sent: unknown[] = [];
    const watched: unknown[] = [];
    const transport = createChatTransport(
      {
        mutation: async (_ref, args) => {
          sent.push(args);
          return run;
        },
        query: async () => null,
        watchQuery: (_ref, args) => {
          watched.push(args);
          return {
            localQueryResult: () => read,
            onUpdate: () => () => {},
          };
        },
      },
      fakeChat(),
      { caseId: "case-1" },
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ],
      abortSignal: undefined,
    });
    const chunks = await readChunks(stream);

    expect(sent).toEqual([
      {
        caseId: "case-1",
        chatId: "chat-1",
        trigger: "submit-message",
        messageId: undefined,
        message: {
          clientKey: "message-1",
          message: {
            author: { type: "user" },
            content: [{ type: "text", text: "Hello" }],
          },
        },
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
        body: undefined,
        metadata: undefined,
      },
    ]);
    expect(watched).toEqual([
      {
        caseId: "case-1",
        runId: "run-1",
        streamArgs: { cursor: null, numItems: 128 },
      },
    ]);
    expect(chunks).toContainEqual({
      type: "text-delta",
      id: "text-0",
      delta: "Hello from Convex realtime",
    });
  });

  test("returns null on reconnect when no resume function is provided", async () => {
    const transport = createChatTransport(
      {
        mutation: async () => fakeRun(),
        query: async () => null,
        watchQuery: () => {
          throw new Error("Unexpected watch");
        },
      },
      fakeChat(),
      { caseId: "case-1" },
    );

    await expect(
      transport.reconnectToStream({ chatId: "chat-1" }),
    ).resolves.toBeNull();
  });
});

function fakeChat(): AgentChat<{ caseId: string }> {
  return {
    list: {} as FunctionReference<
      "query",
      "public",
      { caseId: string },
      AgentMessageDoc[]
    >,
    send: {} as FunctionReference<
      "mutation",
      "public",
      {
        caseId: string;
        chatId: string;
        trigger: "submit-message" | "regenerate-message";
        messageId?: string;
        message: AgentMessageInput;
        messages: UIMessage[];
      },
      AgentRun
    >,
    read: {} as FunctionReference<
      "query",
      "public",
      {
        caseId: string;
        runId: string;
        streamArgs: { cursor: string | null; numItems: number };
      },
      AgentRunEventRead
    >,
  };
}

function fakeRun(): AgentRun {
  return {
    runId: "run-1",
    threadId: "thread-1",
    agentName: "Support Agent",
    messageId: "message-1",
    streamId: "stream-1",
    status: "running",
    _creationTime: 1,
    updatedAt: 1,
  };
}

function fakeRead(): AgentRunEventRead {
  return {
    page: [
      {
        index: 0,
        sequence: 0,
        event: {
          type: "text.delta",
          text: "Hello from Convex realtime",
        },
      },
    ],
    continueCursor: "cursor-1",
    nextIndex: 1,
    isDone: true,
    upToDate: true,
    status: "success",
    streamStatus: "success",
  };
}
