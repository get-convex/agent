import { describe, test, expect, vi } from "vitest";
import {
  guessMimeType,
  serializeDataOrUrl,
  toModelMessageDataOrUrl,
  serializeMessage,
  serializeNewMessagesInStep,
  toModelMessage,
  serializeContent,
  toModelMessageContent,
  autoDenyUnresolvedApprovals,
} from "./mapping.js";
import { api } from "./component/_generated/api.js";
import type { AgentComponent, ActionCtx } from "./client/types.js";
import { vMessage, vToolResultPart } from "./validators.js";
import fs from "fs";
import path from "path";
import type { SerializedContent } from "./mapping.js";
import { validate } from "convex-helpers/validators";
import type { ModelMessage, StepResult, ToolResultPart, ToolSet } from "ai";
import type { Infer } from "convex/values";

const testAssetsDir = path.join(__dirname, "../test-assets");
const testFiles = [
  "book.svg",
  "bump.jpeg",
  "stack.png",
  "favicon.ico",
  "convex-logo.svg",
  "stack-light@3x.webp",
];

function fileToArrayBuffer(filePath: string): ArrayBuffer {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("mapping", () => {
  test("infers correct mimeType for all test-assets", () => {
    const expected: { [key: string]: string } = {
      "book.svg": "image/svg+xml", // <svg
      "bump.jpeg": "image/jpeg",
      "stack.png": "image/png",
      "favicon.ico": "application/octet-stream", // fallback for ico
      "convex-logo.svg": "image/svg+xml", // <?xm
      "stack-light@3x.webp": "image/webp",
      "cat.gif": "image/gif",
    };
    for (const file of testFiles) {
      const ab = fileToArrayBuffer(path.join(testAssetsDir, file));
      const mime = guessMimeType(ab);
      expect(mime).toBe(expected[file]);
    }
  });

  test("turns Uint8Array into ArrayBuffer and round-trips", () => {
    const arr = new Uint8Array([1, 2, 3, 4, 5]);
    // serializeDataOrUrl should return the same ArrayBuffer
    const ser = serializeDataOrUrl(arr);
    expect(ser).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(ser as ArrayBuffer)).toEqual(arr);
    // toModelMessageDataOrUrl should return the same ArrayBuffer
    const deser = toModelMessageDataOrUrl(ser);
    expect(deser).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(deser as ArrayBuffer)).toEqual(arr);
  });

  test("round-trip serialize/deserialize message", async () => {
    const message = {
      role: "user" as const,
      content: "hello world",
      providerOptions: {},
    };
    // Fake ctx and component
    const ctx = {
      runAction: async () => undefined,
      runMutation: async () => undefined,
      storage: {
        store: async () => "storageId",
        getUrl: async () => "https://example.com/file",
        delete: async () => undefined,
      },
    } as unknown as ActionCtx;
    const component = api as unknown as AgentComponent;
    const { message: ser } = await serializeMessage(ctx, component, message);
    // Use is for type validation
    expect(validate(vMessage, ser)).toBeTruthy();
    const round = toModelMessage(ser);
    expect(round).toEqual(message);
  });

  test("tool output round-trips", async () => {
    const toolResult = {
      type: "tool-result" as const,
      toolCallId: "tool-call-id",
      toolName: "tool-name",
      output: {
        type: "text",
        value: "hello world",
      },
    } satisfies ToolResultPart;
    const [result] = toModelMessageContent([toolResult]);
    expect(result).toMatchObject(toolResult);
    const {
      content: [roundtrip],
    } = await serializeContent({} as ActionCtx, {} as AgentComponent, [
      result as ToolResultPart,
    ]);
    expect(roundtrip).toMatchObject(toolResult);
  });

  test("tool results get normalized to output", async () => {
    const toolResult = {
      type: "tool-result" as const,
      toolCallId: "tool-call-id",
      toolName: "tool-name",
      result: "hello world",
    } satisfies Infer<typeof vToolResultPart>;
    const expected = {
      type: "tool-result",
      toolCallId: "tool-call-id",
      toolName: "tool-name",
      output: {
        type: "text",
        value: "hello world",
      },
    };
    const [deserialized] = toModelMessageContent([toolResult]);
    expect(deserialized).toMatchObject(expected);
    const {
      content: [serialized],
    } = await serializeContent({} as ActionCtx, {} as AgentComponent, [
      toolResult,
    ]);
    expect(serialized).toMatchObject(expected);
  });

  test("saving files returns fileIds when too big", async () => {
    // Make a big file
    const bigArr = new Uint8Array(1024 * 65).fill(1);
    const ab = bigArr.buffer.slice(
      bigArr.byteOffset,
      bigArr.byteOffset + bigArr.byteLength,
    );
    let called = false;
    const ctx = {
      runAction: async () => undefined,
      runMutation: async (_fn: unknown, _args: unknown) => {
        called = true;
        return { fileId: "file-123", storageId: "storage-123" };
      },
      storage: {
        store: async () => "storageId",
        getUrl: async () => "https://example.com/file",
        delete: async () => undefined,
      },
    } as unknown as ActionCtx;
    const component = api as unknown as AgentComponent;
    const content = [
      {
        type: "file" as const,
        data: ab,
        filename: "bigfile.bin",
        mimeType: "application/octet-stream",
        providerOptions: {},
      },
    ];
    const { content: ser, fileIds } = await serializeContent(
      ctx,
      component,
      content,
    );
    expect(called).toBe(true);
    expect(fileIds).toEqual(["file-123"]);
    // Should have replaced data with a URL
    const serArr = ser as SerializedContent;
    expect(typeof (serArr as { data: unknown }[])[0].data).toBe("string");
    expect((serArr as { data: unknown }[])[0].data as string).toMatch(
      /^https?:\/\//,
    );
  });

  test("sanity: fileIds are not returned for small files", async () => {
    const arr = new Uint8Array([1, 2, 3, 4, 5]);
    const ab = arr.buffer.slice(
      arr.byteOffset,
      arr.byteOffset + arr.byteLength,
    );
    const ctx = {
      runAction: async () => undefined,
      runMutation: async () => ({
        fileId: "file-123",
        storageId: "storage-123",
      }),
      storage: {
        store: async () => "storageId",
        getUrl: async () => "https://example.com/file",
        delete: async () => undefined,
      },
    } as unknown as ActionCtx;
    const component = api as unknown as AgentComponent;
    const content = [
      {
        type: "file" as const,
        data: ab,
        filename: "smallfile.bin",
        mimeType: "application/octet-stream",
        providerOptions: {},
      },
    ];
    const { fileIds } = await serializeContent(ctx, component, content);
    expect(fileIds).toBeUndefined();
  });

  test("tool-approval-request is preserved after serialization", async () => {
    const approvalRequest = {
      type: "tool-approval-request" as const,
      approvalId: "approval-123",
      toolCallId: "tool-call-456",
    };
    const { content } = await serializeContent(
      {} as ActionCtx,
      {} as AgentComponent,
      [approvalRequest],
    );
    expect(content).toHaveLength(1);
    expect((content as unknown[])[0]).toMatchObject(approvalRequest);
  });

  test("tool-approval-response with approved: true is preserved", async () => {
    const approvalResponse = {
      type: "tool-approval-response" as const,
      approvalId: "approval-123",
      approved: true,
      reason: "User approved",
    };
    const { content } = await serializeContent(
      {} as ActionCtx,
      {} as AgentComponent,
      [approvalResponse],
    );
    expect(content).toHaveLength(1);
    expect((content as unknown[])[0]).toMatchObject(approvalResponse);
  });

  test("tool-approval-response with approved: false is preserved", async () => {
    const approvalResponse = {
      type: "tool-approval-response" as const,
      approvalId: "approval-123",
      approved: false,
      reason: "User denied",
      providerExecuted: false,
    };
    const { content } = await serializeContent(
      {} as ActionCtx,
      {} as AgentComponent,
      [approvalResponse],
    );
    expect(content).toHaveLength(1);
    expect((content as unknown[])[0]).toMatchObject(approvalResponse);
  });

  describe("serializeNewMessagesInStep", () => {
    const ctx = {
      runAction: async () => undefined,
      runMutation: async () => undefined,
      storage: {
        store: async () => "storageId",
        getUrl: async () => "https://example.com/file",
        delete: async () => undefined,
      },
    } as unknown as ActionCtx;
    const component = api as unknown as AgentComponent;

    const step0Messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "search", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "search",
            output: { type: "text", value: "ok" },
          },
        ],
      },
    ];
    const step1Messages: ModelMessage[] = [
      ...step0Messages,
      { role: "assistant", content: [{ type: "text", text: "thinking" }] },
    ];
    const step2Messages: ModelMessage[] = [
      ...step1Messages,
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c2", toolName: "search", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c2",
            toolName: "search",
            output: { type: "text", value: "done" },
          },
        ],
      },
    ];

    const makeStep = (messages: ModelMessage[]): StepResult<ToolSet> =>
      ({
        content: [],
        text: "",
        reasoning: [],
        reasoningText: undefined,
        files: [],
        sources: [],
        toolCalls: [],
        staticToolCalls: [],
        dynamicToolCalls: [],
        toolResults: [],
        staticToolResults: [],
        dynamicToolResults: [],
        finishReason: "stop",
        rawFinishReason: undefined,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: undefined,
        request: {},
        response: {
          id: "resp",
          timestamp: new Date(),
          modelId: "test",
          messages,
        },
        providerMetadata: undefined,
      }) as unknown as StepResult<ToolSet>;

    const contentTypes = (msg: { content: unknown }): string[] => {
      const c = msg.content;
      if (!Array.isArray(c)) return ["text"];
      return c.map((p: { type?: string }) => p.type ?? "?");
    };

    test("first step (count=0) serializes all response messages", async () => {
      const res = await serializeNewMessagesInStep(
        ctx,
        component,
        makeStep(step0Messages),
        undefined,
        0,
      );
      expect(res.messages).toHaveLength(2);
      expect(res.messages[0].message.role).toBe("assistant");
      expect(contentTypes(res.messages[0].message)).toEqual(["tool-call"]);
      expect(res.messages[1].message.role).toBe("tool");
      expect(contentTypes(res.messages[1].message)).toEqual(["tool-result"]);
    });

    test("middle step (count=2) serializes only the new text message", async () => {
      const res = await serializeNewMessagesInStep(
        ctx,
        component,
        makeStep(step1Messages),
        undefined,
        2,
      );
      expect(res.messages).toHaveLength(1);
      expect(res.messages[0].message.role).toBe("assistant");
      expect(contentTypes(res.messages[0].message)).toEqual(["text"]);
    });

    test("multi-message step (count=3) serializes the new tool-call + tool-result pair", async () => {
      const res = await serializeNewMessagesInStep(
        ctx,
        component,
        makeStep(step2Messages),
        undefined,
        3,
      );
      expect(res.messages).toHaveLength(2);
      expect(res.messages[0].message.role).toBe("assistant");
      expect(contentTypes(res.messages[0].message)).toEqual(["tool-call"]);
      expect(res.messages[1].message.role).toBe("tool");
      expect(contentTypes(res.messages[1].message)).toEqual(["tool-result"]);
    });

    // Regression test for the actually-broken shape: a single step appended
    // assistant(text) + assistant(tool-call) + tool(tool-result), so the new
    // tail has length 3 and the last message is a tool message. The old
    // heuristic took `slice(-2)` whenever the last role was "tool" and would
    // have dropped the leading text. The watermark returns all three.
    test("returns all three messages when a step adds text + tool-call + tool-result", async () => {
      const stepMessages: ModelMessage[] = [
        ...step0Messages, // length 2
        { role: "assistant", content: [{ type: "text", text: "Let me check..." }] },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "c3", toolName: "search", input: {} },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "c3",
              toolName: "search",
              output: { type: "text", value: "done" },
            },
          ],
        },
      ];
      const res = await serializeNewMessagesInStep(
        ctx,
        component,
        makeStep(stepMessages),
        undefined,
        step0Messages.length,
      );
      expect(res.messages).toHaveLength(3);
      expect(res.messages[0].message.role).toBe("assistant");
      expect(contentTypes(res.messages[0].message)).toEqual(["text"]);
      expect(res.messages[1].message.role).toBe("assistant");
      expect(contentTypes(res.messages[1].message)).toEqual(["tool-call"]);
      expect(res.messages[2].message.role).toBe("tool");
      expect(contentTypes(res.messages[2].message)).toEqual(["tool-result"]);
    });

    test("empty response messages slice falls back to synthetic empty assistant", async () => {
      const res = await serializeNewMessagesInStep(
        ctx,
        component,
        makeStep(step1Messages),
        undefined,
        step1Messages.length,
      );
      expect(res.messages).toHaveLength(1);
      expect(res.messages[0].message.role).toBe("assistant");
      expect(res.messages[0].message.content).toEqual([]);
    });

    // Pin the caller-drift behavior: if the watermark is past the end of
    // response.messages (e.g. the caller mistracked), the slice is empty and
    // we fall through to the synthetic anchor. Future "fixes" should not
    // accidentally change this without intent.
    test("watermark beyond response.messages.length returns the synthetic fallback", async () => {
      const res = await serializeNewMessagesInStep(
        ctx,
        component,
        makeStep(step1Messages),
        undefined,
        step1Messages.length + 5,
      );
      expect(res.messages).toHaveLength(1);
      expect(res.messages[0].message.role).toBe("assistant");
      expect(res.messages[0].message.content).toEqual([]);
    });

    // AI SDK v6 makes step.response.messages cumulative across steps:
    // step N's array contains all messages from steps 0..N. Without the
    // previousResponseMessageCount watermark, every multi-step save duplicates
    // all prior messages. These tests demonstrate the bug and the fix.
    describe("multi-step loop — previousStep watermark", () => {
      test("without watermark, step 2 re-saves all cumulative messages (demonstrates the bug)", async () => {
        // step2Messages = step0 (2 msgs) + step1 (1 msg) + step2 new (2 msgs) = 5 total
        const res = await serializeNewMessagesInStep(
          ctx,
          component,
          makeStep(step2Messages),
          undefined,
          0,
        );
        expect(res.messages).toHaveLength(5);
      });

      test("with watermark, step 2 saves only its 2 new messages", async () => {
        const step1 = makeStep(step1Messages);
        const res = await serializeNewMessagesInStep(
          ctx,
          component,
          makeStep(step2Messages),
          undefined,
          step1.response.messages.length,
        );
        expect(res.messages).toHaveLength(2);
        expect(contentTypes(res.messages[0].message)).toEqual(["tool-call"]);
        expect(contentTypes(res.messages[1].message)).toEqual(["tool-result"]);
      });
    });
  });

  describe("autoDenyUnresolvedApprovals", () => {
    test("returns messages unchanged when no unresolved approvals", () => {
      const messages = [
        { role: "user" as const, content: "hello" },
        {
          role: "assistant" as const,
          content: [
            { type: "tool-call", toolCallId: "tc1", toolName: "a", input: {} },
            {
              type: "tool-approval-request",
              approvalId: "ap1",
              toolCallId: "tc1",
            },
          ],
        },
        {
          role: "tool" as const,
          content: [
            {
              type: "tool-approval-response",
              approvalId: "ap1",
              approved: true,
            },
          ],
        },
      ] as any;

      const result = autoDenyUnresolvedApprovals(messages);
      expect(result).toBe(messages); // same reference, no changes
    });

    test("injects synthetic denial for a single unresolved approval", () => {
      const messages = [
        { role: "user" as const, content: "hello" },
        {
          role: "assistant" as const,
          content: [
            { type: "tool-call", toolCallId: "tc1", toolName: "a", input: {} },
            {
              type: "tool-approval-request",
              approvalId: "ap1",
              toolCallId: "tc1",
            },
          ],
        },
        { role: "user" as const, content: "new message" },
      ] as any;

      const result = autoDenyUnresolvedApprovals(messages);
      expect(result).toHaveLength(4); // original 3 + 1 synthetic tool message
      // Synthetic denial should be inserted right after the assistant message (index 1)
      expect(result[2].role).toBe("tool");
      const denialContent = result[2].content as any[];
      expect(denialContent).toHaveLength(1);
      expect(denialContent[0].type).toBe("tool-approval-response");
      expect(denialContent[0].approvalId).toBe("ap1");
      expect(denialContent[0].approved).toBe(false);
      expect(denialContent[0].reason).toBe(
        "auto-denied: new generation started",
      );
      // The new user message should follow
      expect(result[3].role).toBe("user");
      expect(result[3].content).toBe("new message");
    });

    test("groups multiple unresolved approvals from the same step into a single synthetic message", () => {
      const messages = [
        {
          role: "assistant" as const,
          content: [
            { type: "tool-call", toolCallId: "tc1", toolName: "a", input: {} },
            { type: "tool-call", toolCallId: "tc2", toolName: "b", input: {} },
            {
              type: "tool-approval-request",
              approvalId: "ap1",
              toolCallId: "tc1",
            },
            {
              type: "tool-approval-request",
              approvalId: "ap2",
              toolCallId: "tc2",
            },
          ],
        },
      ] as any;

      const result = autoDenyUnresolvedApprovals(messages);
      expect(result).toHaveLength(2); // assistant + 1 synthetic tool message
      expect(result[1].role).toBe("tool");
      const denialContent = result[1].content as any[];
      expect(denialContent).toHaveLength(2);
      expect(denialContent[0].approvalId).toBe("ap1");
      expect(denialContent[0].approved).toBe(false);
      expect(denialContent[1].approvalId).toBe("ap2");
      expect(denialContent[1].approved).toBe(false);
    });

    test("only auto-denies unresolved approvals, leaves resolved ones alone", () => {
      const messages = [
        {
          role: "assistant" as const,
          content: [
            { type: "tool-call", toolCallId: "tc1", toolName: "a", input: {} },
            { type: "tool-call", toolCallId: "tc2", toolName: "b", input: {} },
            {
              type: "tool-approval-request",
              approvalId: "ap1",
              toolCallId: "tc1",
            },
            {
              type: "tool-approval-request",
              approvalId: "ap2",
              toolCallId: "tc2",
            },
          ],
        },
        {
          role: "tool" as const,
          content: [
            {
              type: "tool-approval-response",
              approvalId: "ap1",
              approved: true,
            },
          ],
        },
        { role: "user" as const, content: "next question" },
      ] as any;

      const result = autoDenyUnresolvedApprovals(messages);
      // Should inject a denial for ap2 (unresolved) after the assistant message
      expect(result).toHaveLength(4); // assistant + existing tool + synthetic denial + user
      // The synthetic denial is inserted after the assistant (index 0)
      expect(result[0].role).toBe("assistant");
      expect(result[1].role).toBe("tool"); // synthetic denial for ap2
      const denialContent = result[1].content as any[];
      expect(denialContent).toHaveLength(1);
      expect(denialContent[0].approvalId).toBe("ap2");
      expect(denialContent[0].approved).toBe(false);
      // Original tool message (ap1 response) follows
      expect(result[2].role).toBe("tool");
      const originalToolContent = result[2].content as any[];
      expect(originalToolContent[0].approvalId).toBe("ap1");
      expect(originalToolContent[0].approved).toBe(true);
      // User message last
      expect(result[3].role).toBe("user");
    });

    test("emits console.warn for each auto-denied approval", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const messages = [
        {
          role: "assistant" as const,
          content: [
            { type: "tool-call", toolCallId: "tc1", toolName: "a", input: {} },
            { type: "tool-call", toolCallId: "tc2", toolName: "b", input: {} },
            {
              type: "tool-approval-request",
              approvalId: "ap1",
              toolCallId: "tc1",
            },
            {
              type: "tool-approval-request",
              approvalId: "ap2",
              toolCallId: "tc2",
            },
          ],
        },
      ] as any;

      autoDenyUnresolvedApprovals(messages);

      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ap1"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ap2"));
      warnSpy.mockRestore();
    });
  });
});
