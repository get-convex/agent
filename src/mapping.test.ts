import { describe, test, expect } from "vitest";
import {
  guessMimeType,
  serializeDataOrUrl,
  toModelMessageDataOrUrl,
  serializeMessage,
  toModelMessage,
  serializeContent,
  toModelMessageContent,
  mergeApprovalResponseMessages,
} from "./mapping.js";
import { api } from "./component/_generated/api.js";
import type { AgentComponent, ActionCtx } from "./client/types.js";
import { vMessage, vToolResultPart } from "./validators.js";
import fs from "fs";
import path from "path";
import type { SerializedContent } from "./mapping.js";
import { validate } from "convex-helpers/validators";
import type { ToolResultPart } from "ai";
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

  test("mergeApprovalResponseMessages merges consecutive tool approval messages", () => {
    const messages = [
      { role: "user" as const, content: "hello" },
      {
        role: "assistant" as const,
        content: [
          { type: "tool-call", toolCallId: "tc1", toolName: "a", input: {} },
          { type: "tool-call", toolCallId: "tc2", toolName: "b", input: {} },
          { type: "tool-approval-request", approvalId: "ap1", toolCallId: "tc1" },
          { type: "tool-approval-request", approvalId: "ap2", toolCallId: "tc2" },
        ],
      },
      {
        role: "tool" as const,
        content: [
          { type: "tool-approval-response", approvalId: "ap1", approved: true },
        ],
      },
      {
        role: "tool" as const,
        content: [
          { type: "tool-approval-response", approvalId: "ap2", approved: false, reason: "denied" },
        ],
      },
    ] as any;

    const merged = mergeApprovalResponseMessages(messages);
    expect(merged).toHaveLength(3); // user, assistant, single tool
    expect(merged[2].role).toBe("tool");
    const toolContent = merged[2].content as Array<{ type: string; approvalId: string }>;
    expect(toolContent).toHaveLength(2);
    expect(toolContent[0].approvalId).toBe("ap1");
    expect(toolContent[1].approvalId).toBe("ap2");
  });

  test("mergeApprovalResponseMessages does not merge non-approval tool messages", () => {
    const messages = [
      {
        role: "tool" as const,
        content: [
          { type: "tool-result", toolCallId: "tc1", toolName: "a", output: { type: "text", value: "ok" } },
        ],
      },
      {
        role: "tool" as const,
        content: [
          { type: "tool-approval-response", approvalId: "ap1", approved: true },
        ],
      },
    ] as any;

    const merged = mergeApprovalResponseMessages(messages);
    expect(merged).toHaveLength(2); // not merged since first has tool-result
  });
});
