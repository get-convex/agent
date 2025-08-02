import { describe, it, expect } from "vitest";
import { toUIMessages } from "./toUIMessages.js";
import type { MessageDoc } from "../client/index.js";
import { assert } from "convex-helpers";

// Helper to create a base message doc
function baseMessageDoc(overrides: Partial<MessageDoc> = {}): MessageDoc {
  return {
    _id: "msg1",
    _creationTime: Date.now(),
    order: 1,
    stepOrder: 0,
    status: "success",
    threadId: "thread1",
    tool: false,
    ...overrides,
  };
}

describe("toUIMessages", () => {
  it("handles user message", () => {
    const messages = [
      baseMessageDoc({
        message: {
          role: "user",
          content: "Hello!",
        },
        text: "Hello!",
      }),
    ];
    const uiMessages = toUIMessages(messages);
    expect(uiMessages).toHaveLength(1);
    expect(uiMessages[0].role).toBe("user");
    expect(uiMessages[0].text).toBe("Hello!");
    expect(uiMessages[0].parts[0]).toEqual({ type: "text", text: "Hello!" });
  });

  it("handles assistant message", () => {
    const messages = [
      baseMessageDoc({
        message: {
          role: "assistant",
          content: "Hi, how can I help?",
        },
        text: "Hi, how can I help?",
      }),
    ];
    const uiMessages = toUIMessages(messages);
    expect(uiMessages).toHaveLength(1);
    expect(uiMessages[0].role).toBe("assistant");
    expect(uiMessages[0].text).toBe("Hi, how can I help?");
    expect(uiMessages[0].parts[0]).toEqual({
      type: "text",
      text: "Hi, how can I help?",
      state: "done",
    });
  });

  it("handles multiple messages", () => {
    const messages = [
      baseMessageDoc({
        message: {
          role: "user",
          content: "Hello!",
        },
        text: "Hello!",
      }),
      baseMessageDoc({
        message: {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "I'm thinking...",
            },
            {
              type: "redacted-reasoning",
              data: "asdfasdfasdf",
            },
            {
              type: "text",
              text: "I'm thinking...",
            },
            {
              type: "file",
              mimeType: "text/plain",
              data: "https://example.com/file.txt",
            },
            {
              type: "tool-call",
              toolName: "myTool",
              toolCallId: "call1",
              args: "an arg",
            },
          ],
        },
        tool: true,
        reasoning: "I'm thinking...",
        text: "I'm thinking...",
      }),
      baseMessageDoc({
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call1",
              toolName: "myTool",
              result: "42",
            },
          ],
        },
        tool: true,
      }),
    ];
    const uiMessages = toUIMessages(messages);
    expect(uiMessages).toHaveLength(2);
    expect(uiMessages[0].role).toBe("user");
    expect(uiMessages[0].parts.filter((p) => p.type === "text")).toHaveLength(
      1,
    );
    expect(uiMessages[1].role).toBe("assistant");
    expect(
      uiMessages[1].parts.filter((p) => p.type === "tool-myTool"),
    ).toHaveLength(1);
    expect(
      uiMessages[1].parts.filter((p) => p.type === "tool-myTool")[0],
    ).toMatchObject({
      type: "tool-myTool",
      toolCallId: "call1",
      state: "output-available",
      output: "42",
    });
  });

  it("handles multiple text and reasoning parts", () => {
    const messages = [
      baseMessageDoc({
        message: {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "I'm thinking...",
            },
            {
              type: "text",
              text: "Here's one idea.",
            },
            {
              type: "reasoning",
              text: "I'm thinking...",
            },
            {
              type: "text",
              text: "Here's another idea.",
            },
          ],
        },
        reasoning: "I'm thinking...I'm thinking...",
        text: "Here's one idea. Here's another idea.",
      }),
    ];
    const uiMessages = toUIMessages(messages);
    expect(uiMessages).toHaveLength(1);
    expect(uiMessages[0].role).toBe("assistant");
    expect(uiMessages[0].text).toBe("Here's one idea. Here's another idea.");
    expect(uiMessages[0].parts.filter((p) => p.type === "reasoning")).toEqual([
      {
        providerMetadata: undefined,
        state: undefined,
        text: "I'm thinking...",
        type: "reasoning",
      },
      {
        providerMetadata: undefined,
        state: undefined,
        text: "I'm thinking...",
        type: "reasoning",
      },
    ]);
    expect(uiMessages[0].parts[0].type).toBe("reasoning");
    assert(uiMessages[0].parts[0].type === "reasoning");
    expect(uiMessages[0].parts[0].text).toBe("I'm thinking...");
    expect(uiMessages[0].parts[1].type).toBe("text");
    assert(uiMessages[0].parts[1].type === "text");
    expect(uiMessages[0].parts[1].text).toBe("Here's one idea.");
    expect(uiMessages[0].parts[2].type).toBe("reasoning");
    assert(uiMessages[0].parts[2].type === "reasoning");
    expect(uiMessages[0].parts[2].text).toBe("I'm thinking...");

    expect(uiMessages[0].parts.filter((p) => p.type === "text")).toHaveLength(
      2,
    );
    expect(uiMessages[0].parts.filter((p) => p.type === "text")[0].text).toBe(
      "Here's one idea.",
    );
    expect(uiMessages[0].parts.filter((p) => p.type === "text")[1].text).toBe(
      "Here's another idea.",
    );
  });

  it("handles system message", () => {
    const messages = [
      baseMessageDoc({
        message: {
          role: "system",
          content: "System message here",
        },
        text: "System message here",
      }),
    ];
    const uiMessages = toUIMessages(messages);
    expect(uiMessages).toHaveLength(1);
    expect(uiMessages[0].role).toBe("system");
    expect(uiMessages[0].text).toBe("System message here");
    expect(uiMessages[0].parts[0]).toEqual({
      type: "text",
      text: "System message here",
      state: "done",
      providerMetadata: undefined,
    });
  });

  it("handles tool call", () => {
    const messages = [
      baseMessageDoc({
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "myTool",
              toolCallId: "call1",
              args: "hi",
            },
          ],
        },
        text: "",
      }),
    ];
    const uiMessages = toUIMessages(messages);
    expect(uiMessages).toHaveLength(1);
    expect(uiMessages[0].role).toBe("assistant");
    expect(
      uiMessages[0].parts.filter((p) => p.type === "tool-call")[0],
    ).toMatchObject({
      type: "tool-call",
      toolName: "myTool",
      toolCallId: "call1",
      input: "hi",
      state: "input-available",
    });
  });

  it("handles tool result", () => {
    const messages = [
      baseMessageDoc({
        tool: true,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "myTool",
              toolCallId: "call1",
              args: "",
            },
          ],
        },
        text: "",
      }),
      baseMessageDoc({
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call1",
              toolName: "myTool",
              result: "42",
            },
          ],
        },
        text: "",
      }),
    ];
    const uiMessages = toUIMessages(messages);
    expect(uiMessages).toHaveLength(1);
    expect(uiMessages[0].role).toBe("assistant");
    // Should have a tool-invocation part
    expect(uiMessages[0].parts.some((p) => p.type === "tool-myTool")).toBe(
      true,
    );
  });

  it("does not duplicate text content", () => {
    const messages = [
      baseMessageDoc({
        message: {
          role: "assistant",
          content: "Hello!",
        },
        text: "Hello!",
      }),
    ];
    const uiMessages = toUIMessages(messages);
    // There should only be one text part
    const textParts = uiMessages[0].parts.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toBe("Hello!");
  });

  // Add more tests for array content, tool calls, etc. as needed
});
