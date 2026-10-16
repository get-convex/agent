import type { UIMessage } from "@convex-dev/agent/react";
import { describe, expect, it } from "vitest";
import { convertMessage } from "./convertMessage";

const message: UIMessage = {
  id: "stream-id",
  key: "thread-1-0",
  role: "assistant",
  parts: [{ type: "text", text: "Once upon a time" }],
  text: "Once upon a time",
  status: "streaming",
  order: 1,
  stepOrder: 0,
  _creationTime: 1_700_000_000_000,
};

describe("convertMessage", () => {
  it("keeps the same runtime ID when a streamed message is persisted", () => {
    const streaming = convertMessage(message);
    const saved = convertMessage({
      ...message,
      id: "database-id",
      status: "success",
    });
    expect(streaming.id).toBe(message.key);
    expect(saved.id).toBe(streaming.id);
    expect(streaming.status).toEqual({ type: "running" });
    expect(saved.status).toEqual({ type: "complete", reason: "stop" });
    expect(saved.createdAt).toEqual(new Date(message._creationTime));
  });

  it("preserves ordered text, reasoning, and tool results", () => {
    expect(
      convertMessage({
        ...message,
        status: "success",
        parts: [
          { type: "step-start" },
          { type: "reasoning", text: "I need two characters." },
          {
            type: "tool-getCharacterNames",
            toolCallId: "call-1",
            state: "output-available",
            input: { count: 2 },
            output: ["Alice", "Bob"],
          },
          { type: "text", text: "Alice met Bob." },
        ],
      }).content,
    ).toEqual([
      { type: "reasoning", text: "I need two characters." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "getCharacterNames",
        argsText: '{"count":2}',
        result: ["Alice", "Bob"],
      },
      { type: "text", text: "Alice met Bob." },
    ]);
  });

  it("represents a tool call while its input is still streaming", () => {
    expect(
      convertMessage({
        ...message,
        parts: [
          {
            type: "dynamic-tool",
            toolName: "getCharacterNames",
            toolCallId: "call-1",
            state: "input-streaming",
          },
        ],
      }).content,
    ).toEqual([
      {
        type: "tool-call",
        toolName: "getCharacterNames",
        toolCallId: "call-1",
        argsText: "{}",
      },
    ]);
  });

  it("exposes tool failures and incomplete assistant responses", () => {
    const result = convertMessage({
      ...message,
      status: "failed",
      parts: [
        {
          type: "tool-getCharacterNames",
          toolCallId: "call-1",
          state: "output-error",
          input: {},
          errorText: "Tool unavailable",
        },
      ],
    });
    expect(result.content).toEqual([
      {
        type: "tool-call",
        toolName: "getCharacterNames",
        toolCallId: "call-1",
        argsText: "{}",
        result: "Tool unavailable",
        isError: true,
      },
    ]);
    expect(result.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("keeps pending assistant messages running", () => {
    expect(
      convertMessage({ ...message, status: "pending", parts: [] }).status,
    ).toEqual({ type: "running" });
  });

  it("does not assign assistant status to a user message", () => {
    const result = convertMessage({
      ...message,
      role: "user",
      status: "success",
    });
    expect(result.role).toBe("user");
    expect(result.content).toEqual(message.parts);
    expect(result.status).toBeUndefined();
  });
});
