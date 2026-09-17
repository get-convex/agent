import { describe, expect, it } from "vitest";
import type { UIMessage } from "@convex-dev/agent/react";
import { toAssistantUIMessage } from "./assistantUiMessages";

const message: UIMessage = {
  id: "stream-id",
  key: "thread-1-0",
  role: "assistant",
  order: 1,
  stepOrder: 0,
  status: "streaming",
  _creationTime: 1234,
  text: "A story",
  parts: [
    { type: "reasoning", text: "Choose names" },
    { type: "step-start" },
    {
      type: "tool-getCharacterNames",
      toolCallId: "names",
      state: "output-available",
      input: { count: 2 },
      output: ["Eleanor", "Henry"],
    },
    { type: "text", text: "A story" },
  ],
};

describe("assistant-ui message conversion", () => {
  it("preserves content order and server tool results while omitting step markers", () => {
    expect(toAssistantUIMessage(message)).toEqual({
      id: message.key,
      role: "assistant",
      createdAt: new Date(1234),
      status: { type: "running" },
      content: [
        { type: "reasoning", text: "Choose names" },
        {
          type: "tool-call",
          toolCallId: "names",
          toolName: "getCharacterNames",
          argsText: '{"count":2}',
          result: ["Eleanor", "Henry"],
          isError: false,
        },
        { type: "text", text: "A story" },
      ],
    });
  });

  it("keeps the same identity when a streamed message is persisted", () => {
    const persisted = toAssistantUIMessage({
      ...message,
      id: "saved-id",
      status: "success",
    });
    expect(persisted.id).toBe(toAssistantUIMessage(message).id);
    expect(persisted.status).toEqual({ type: "complete", reason: "stop" });
  });

  it("maps pending and failed assistant states without adding status to user messages", () => {
    expect(
      toAssistantUIMessage({ ...message, status: "pending" }).status,
    ).toEqual({ type: "running" });
    expect(
      toAssistantUIMessage({ ...message, status: "failed" }).status,
    ).toMatchObject({ type: "incomplete", reason: "error" });
    expect(
      toAssistantUIMessage({ ...message, role: "user", status: "success" })
        .status,
    ).toBeUndefined();
  });

  it("handles dynamic tools, incomplete inputs, and tool errors", () => {
    const result = toAssistantUIMessage({
      ...message,
      parts: [
        {
          type: "dynamic-tool",
          toolName: "lookup",
          toolCallId: "a",
          state: "input-streaming",
          input: undefined,
        },
        {
          type: "dynamic-tool",
          toolName: "lookup",
          toolCallId: "b",
          state: "output-error",
          input: {},
          errorText: "Lookup failed",
        },
      ],
    });
    expect(result.content).toEqual([
      {
        type: "tool-call",
        toolName: "lookup",
        toolCallId: "a",
        argsText: "{}",
        result: undefined,
        isError: false,
      },
      {
        type: "tool-call",
        toolName: "lookup",
        toolCallId: "b",
        argsText: "{}",
        result: "Lookup failed",
        isError: true,
      },
    ]);
  });
});
