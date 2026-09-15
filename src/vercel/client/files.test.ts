/// <reference types="vite/client" />

import { afterEach, describe, expect, test, vi } from "vitest";
import { getFile, MAX_FILE_SIZE, storeFile } from "./files.js";
import {
  actionGeneric,
  anyApi,
  mutationGeneric,
  queryGeneric,
  type ApiFromModules,
} from "convex/server";
import { v } from "convex/values";
import { components, initConvexTest } from "./setup.test.js";
import { Agent, createThread, saveMessage } from "../index.js";
import { saveMessages } from "./messages.js";
import { mockModel } from "./mockModel.js";
import { generateText } from "ai";
import { materializeUIMessageChunkFiles } from "../fileMaterialization.js";

const bytes = new Uint8Array(MAX_FILE_SIZE + 1).fill(65);

// These app-side wrappers authenticate before passing a user ID to the component.
export const uploadOwnedFile = actionGeneric({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const { file } = await storeFile(
      ctx,
      components.agent,
      new Blob([bytes], { type: "text/plain" }),
      {
        userId: identity.subject,
      },
    );
    return { file };
  },
});

export const readOwnedFile = queryGeneric({
  args: { fileId: v.string() },
  returns: v.any(),
  handler: async (ctx, { fileId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const { file } = await getFile(ctx, components.agent, fileId, {
      requireUserId: identity.subject,
    });
    return { file };
  },
});

export const uploadUnscopedFile = actionGeneric({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const { file } = await storeFile(
      ctx,
      components.agent,
      new Blob(["legacy"]),
    );
    return { file };
  },
});

export const saveInlineFiles = actionGeneric({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    kind: v.union(
      v.literal("image"),
      v.literal("file"),
      v.literal("reasoning"),
      v.literal("tool"),
    ),
  },
  returns: v.any(),
  handler: (ctx, { kind, ...args }) =>
    saveMessages(ctx, components.agent, {
      ...args,
      messages: [
        kind === "image"
          ? {
              role: "user",
              content: [
                { type: "image", image: bytes, mediaType: "image/png" },
              ],
            }
          : kind === "file"
            ? {
                role: "user",
                content: [
                  { type: "file", data: bytes, mediaType: "application/pdf" },
                ],
              }
            : kind === "reasoning"
              ? {
                  role: "assistant",
                  content: [
                    {
                      type: "reasoning-file",
                      data: { type: "data", data: bytes },
                      mediaType: "text/plain",
                    },
                  ],
                }
              : {
                  role: "tool",
                  content: [
                    {
                      type: "tool-result",
                      toolCallId: "call",
                      toolName: "test",
                      output: {
                        type: "content",
                        value: [
                          {
                            type: "file",
                            data: { type: "data", data: bytes },
                            mediaType: "text/plain",
                            filename: "tool.txt",
                          },
                        ],
                      },
                    },
                  ],
                },
      ],
    }),
});

export const updateInlineFile = actionGeneric({
  args: { messageId: v.string() },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const agent = new Agent(components.agent, {
      name: "test",
      languageModel: mockModel(),
    });
    await agent.updateMessage(ctx, {
      messageId,
      patch: {
        status: "success",
        message: {
          role: "user",
          content: [{ type: "file", data: bytes, mediaType: "text/plain" }],
        },
      },
    });
  },
});

export const deleteOwnedBlobs = mutationGeneric({
  args: { fileIds: v.array(v.string()), fail: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { fileIds, fail }) => {
    const { storageIdsToDelete } = await ctx.runMutation(
      components.agent.files.deleteFilesWithStorageIds,
      { fileIds, force: true },
    );
    for (const storageId of storageIdsToDelete)
      await ctx.storage.delete(storageId);
    if (fail) throw new Error("storage cleanup failed");
  },
});

export const generateFile = actionGeneric({
  args: {
    threadId: v.string(),
    mode: v.union(
      v.literal("generate"),
      v.literal("stream"),
      v.literal("manual"),
    ),
    kind: v.union(v.literal("file"), v.literal("reasoning-file")),
  },
  returns: v.any(),
  handler: async (ctx, { threadId, mode, kind }) => {
    const model = mockModel({
      content: [
        {
          type: kind,
          data: { type: "data", data: bytes },
          mediaType: "text/plain",
        },
      ],
    });
    const agent = new Agent(components.agent, {
      name: "file-generator",
      languageModel: model,
    });
    if (mode === "stream") {
      await agent.streamText(
        ctx,
        { threadId },
        { prompt: "Generate a file" },
        { saveStreamDeltas: { throttleMs: 0 } },
      );
    } else if (mode === "generate") {
      await agent.generateText(
        ctx,
        { threadId },
        { prompt: "Generate a file" },
      );
    } else {
      const result = await generateText({ model, prompt: "Generate a file" });
      const { messageId } = await saveMessage(ctx, components.agent, {
        threadId,
        prompt: "Generate a file",
      });
      await agent.saveStep(ctx, {
        threadId,
        promptMessageId: messageId,
        step: result.steps[0],
      });
    }
    return agent.listMessages(ctx, {
      threadId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
  },
});

export const saveStreamedToolFile = actionGeneric({
  args: { threadId: v.string() },
  returns: v.any(),
  handler: async (ctx, { threadId }) => {
    const output = {
      type: "content" as const,
      value: [
        {
          type: "file" as const,
          data: { type: "text" as const, text: "A".repeat(MAX_FILE_SIZE + 1) },
          filename: "tool.txt",
          mediaType: "text/plain",
        },
      ],
    };
    const { fileRefs } = await materializeUIMessageChunkFiles(
      ctx,
      components.agent,
      [{ type: "tool-output-available", toolCallId: "tool-call", output }],
      { userId: "alice" },
    );
    const { message } = await saveMessage(ctx, components.agent, {
      threadId,
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool-call",
            toolName: "test",
            output,
          },
        ],
      },
    });
    return { fileRefs, message };
  },
});

const testApi: ApiFromModules<{
  fns: {
    uploadOwnedFile: typeof uploadOwnedFile;
    uploadUnscopedFile: typeof uploadUnscopedFile;
    readOwnedFile: typeof readOwnedFile;
    saveInlineFiles: typeof saveInlineFiles;
    updateInlineFile: typeof updateInlineFile;
    deleteOwnedBlobs: typeof deleteOwnedBlobs;
    generateFile: typeof generateFile;
    saveStreamedToolFile: typeof saveStreamedToolFile;
  };
}>["fns"] = anyApi["files.test"] as any;

describe("storeFile", () => {
  test("throws a clear error when a reused file is missing from storage", async () => {
    const ctx = {
      runAction: async () => null,
      runMutation: async () => ({
        fileId: "existing-file",
        storageId: "existing-storage",
      }),
      storage: {
        getUrl: async () => null,
      },
    } as unknown as Parameters<typeof storeFile>[0];
    const component = {
      files: { useExistingFile: {}, addFile: {} },
    } as unknown as Parameters<typeof storeFile>[1];

    await expect(storeFile(ctx, component, new Blob(["x"]))).rejects.toThrow(
      "File not found in storage: existing-storage",
    );
  });

  test("cleans its losing blob before an existing URL read fails", async () => {
    const deleted: string[] = [];
    let mutationCount = 0;
    const ctx = {
      runAction: async () => null,
      runMutation: async () => {
        mutationCount++;
        return mutationCount === 1
          ? null
          : { fileId: "existing-file", storageId: "existing-storage" };
      },
      storage: {
        store: async () => "new-storage",
        getMetadata: async () => null,
        getUrl: async () => null,
        delete: async (storageId: string) => {
          deleted.push(storageId);
        },
      },
    } as unknown as Parameters<typeof storeFile>[0];
    const component = {
      files: { useExistingFile: {}, addFile: {} },
    } as unknown as Parameters<typeof storeFile>[1];

    await expect(storeFile(ctx, component, new Blob(["x"]))).rejects.toThrow(
      "File not found in storage: existing-storage",
    );
    expect(deleted).toEqual(["new-storage"]);
  });
});

describe("file ownership through the client API", () => {
  afterEach(() => vi.useRealTimers());

  test("authenticated owners can read their files; other users and anonymous callers cannot", async () => {
    const t = initConvexTest();
    const alice = t.withIdentity({ subject: "alice" });
    const bob = t.withIdentity({ subject: "bob" });
    const { file } = await alice.action(testApi.uploadOwnedFile, {});
    expect(file.userId).toBe("alice");
    await expect(
      alice.query(testApi.readOwnedFile, { fileId: file.fileId }),
    ).resolves.toMatchObject({
      file: { userId: "alice", fileId: file.fileId },
    });
    await expect(
      bob.query(testApi.readOwnedFile, { fileId: file.fileId }),
    ).rejects.toThrow("File not found");
    await expect(
      t.query(testApi.readOwnedFile, { fileId: file.fileId }),
    ).rejects.toThrow("Unauthorized");
    await expect(t.action(testApi.uploadOwnedFile, {})).rejects.toThrow(
      "Unauthorized",
    );
    await expect(
      bob.query(testApi.readOwnedFile, {
        fileId: file.fileId,
        // @ts-expect-error Identity cannot be supplied by a browser argument.
        userId: "alice",
      }),
    ).rejects.toThrow();
    const bobUpload = await bob.action(testApi.uploadOwnedFile, {});
    expect(bobUpload.file.fileId).not.toBe(file.fileId);
    expect(bobUpload.file.storageId).not.toBe(file.storageId);
    const reused = await alice.action(testApi.uploadOwnedFile, {});
    expect(reused.file).toEqual(file);
  });

  test("checked reads never resolve URLs for rejected rows or missing user identifiers", async () => {
    const getUrl = vi.fn();
    const ctx = {
      runQuery: vi.fn(async () => null),
      storage: { getUrl },
    } as unknown as Parameters<typeof getFile>[0];
    await expect(
      getFile(ctx, components.agent, "someone-elses-file", {
        requireUserId: "alice",
      }),
    ).rejects.toThrow("File not found");
    await expect(
      getFile(ctx, components.agent, "legacy-file", {
        // @ts-expect-error A supplied check cannot silently accept an undefined user.
        requireUserId: undefined,
      }),
    ).rejects.toThrow("requireUserId must be a string");
    expect(getUrl).not.toHaveBeenCalled();
  });

  test("legacy files still support unchecked server reads, but fail owner checks", async () => {
    const t = initConvexTest();
    const { file } = await t.action(testApi.uploadUnscopedFile, {});
    await t.run(async (ctx) => {
      expect(
        (await getFile(ctx, components.agent, file.fileId)).file.fileId,
      ).toBe(file.fileId);
    });
    await expect(
      t
        .withIdentity({ subject: "alice" })
        .query(testApi.readOwnedFile, { fileId: file.fileId }),
    ).rejects.toThrow("File not found");
  });

  test("racing uploads deduplicate within an owner and clean up losing blobs", async () => {
    const t = initConvexTest();
    const alice = t.withIdentity({ subject: "alice" });
    const uploads = await Promise.all(
      Array.from({ length: 3 }, () =>
        alice.action(testApi.uploadOwnedFile, {}),
      ),
    );
    expect(new Set(uploads.map(({ file }) => file.fileId)).size).toBe(1);
    // Only the registered blob survives even if several actions upload before registration.
    const stored = await t.run((ctx) =>
      ctx.db.system.query("_storage").collect(),
    );
    expect(stored.map((file) => file._id)).toEqual([uploads[0].file.storageId]);
  });

  test.each([undefined, "explicit-owner"])(
    "inline files use thread fallback or explicit owner (%s)",
    async (userId) => {
      const t = initConvexTest();
      const threadId = await t.run((ctx) =>
        createThread(ctx, components.agent, { userId: "thread-owner" }),
      );
      const fileIds: string[] = [];
      for (const kind of ["image", "file", "reasoning", "tool"] as const) {
        const { messages } = await t.action(testApi.saveInlineFiles, {
          threadId,
          userId,
          kind,
        });
        fileIds.push(
          ...messages.flatMap(
            (message: { fileIds?: string[] }) => message.fileIds ?? [],
          ),
        );
      }
      expect(fileIds).toHaveLength(4);
      for (const fileId of fileIds) {
        await expect(
          t.query(components.agent.files.get, { fileId }),
        ).resolves.toMatchObject({
          userId: userId ?? "thread-owner",
          refcount: 1,
        });
      }
    },
  );

  test("message updates inherit the existing owner and reject a missing message before storing files", async () => {
    const t = initConvexTest();
    const threadId = await t.run((ctx) =>
      createThread(ctx, components.agent, { userId: "alice" }),
    );
    const { messageId } = await t.run((ctx) =>
      saveMessage(ctx, components.agent, { threadId, prompt: "before" }),
    );
    await t.action(testApi.updateInlineFile, { messageId });
    const [message] = await t.query(
      components.agent.messages.getMessagesByIds,
      { messageIds: [messageId] },
    );
    expect(message?.fileIds).toHaveLength(1);
    await expect(
      t.query(components.agent.files.get, { fileId: message!.fileIds![0] }),
    ).resolves.toMatchObject({ userId: "alice", refcount: 1 });
    await t.mutation(components.agent.messages.deleteByIds, {
      messageIds: [messageId],
    });
    await expect(
      t.action(testApi.updateInlineFile, { messageId }),
    ).rejects.toThrow("not found");
    const stored = await t.run((ctx) =>
      ctx.db.system.query("_storage").collect(),
    );
    expect(stored).toHaveLength(1);
  });

  test("record and storage deletion roll back together in an app mutation", async () => {
    const t = initConvexTest();
    const { file } = await t
      .withIdentity({ subject: "alice" })
      .action(testApi.uploadOwnedFile, {});
    await expect(
      t.mutation(testApi.deleteOwnedBlobs, {
        fileIds: [file.fileId],
        fail: true,
      }),
    ).rejects.toThrow("storage cleanup failed");
    await expect(
      t.query(components.agent.files.get, { fileId: file.fileId }),
    ).resolves.not.toBeNull();
    expect(
      await t.run(
        async (ctx) => (await ctx.storage.get(file.storageId)) !== null,
      ),
    ).toBe(true);
    await t.mutation(testApi.deleteOwnedBlobs, { fileIds: [file.fileId] });
    await expect(
      t.query(components.agent.files.get, { fileId: file.fileId }),
    ).resolves.toBeNull();
    expect(
      await t.run(
        async (ctx) => (await ctx.storage.get(file.storageId)) !== null,
      ),
    ).toBe(false);
  });

  test.each(["generate", "stream", "manual"] as const)(
    "%s propagates a thread owner to generated files and reasoning files",
    async (mode) => {
      for (const kind of ["file", "reasoning-file"] as const) {
        const t = initConvexTest();
        const threadId = await t.run((ctx) =>
          createThread(ctx, components.agent, { userId: "alice" }),
        );
        const { page } = await t.action(testApi.generateFile, {
          threadId,
          mode,
          kind,
        });
        const fileIds: string[] = page.flatMap(
          (message: { fileIds?: string[] }) => message.fileIds ?? [],
        );
        expect(fileIds).toHaveLength(1);
        await expect(
          t.query(components.agent.files.get, { fileId: fileIds[0] }),
        ).resolves.toMatchObject({ userId: "alice", refcount: 1 });
        // Stream materialization and final serialization must share one blob.
        expect(
          await t.run((ctx) => ctx.db.system.query("_storage").collect()),
        ).toHaveLength(1);
      }
    },
  );

  test("anonymous threads remain unscoped", async () => {
    const t = initConvexTest();
    const threadId = await t.run((ctx) => createThread(ctx, components.agent));
    const { page } = await t.action(testApi.generateFile, {
      threadId,
      mode: "stream",
      kind: "file",
    });
    const fileId = page.flatMap((message) => message.fileIds ?? [])[0];
    expect(fileId).toBeDefined();
    const file = await t.query(components.agent.files.get, { fileId });
    expect(file).not.toBeNull();
    expect(file?.userId).toBeUndefined();
  });

  test("streamed tool-result files reuse their owner's file during final serialization", async () => {
    const t = initConvexTest();
    const threadId = await t.run((ctx) =>
      createThread(ctx, components.agent, { userId: "alice" }),
    );
    const { fileRefs, message } = await t.action(testApi.saveStreamedToolFile, {
      threadId,
    });
    expect(fileRefs).toHaveLength(1);
    expect(message.fileIds).toEqual([fileRefs[0].fileId]);
    await expect(
      t.query(components.agent.files.get, { fileId: fileRefs[0].fileId }),
    ).resolves.toMatchObject({ userId: "alice", refcount: 1 });
  });

  test("trusted cross-user clones retain the original file owner and references", async () => {
    const t = initConvexTest();
    const sourceThreadId = await t.run((ctx) =>
      createThread(ctx, components.agent, { userId: "alice" }),
    );
    const targetThreadId = await t.run((ctx) =>
      createThread(ctx, components.agent, { userId: "bob" }),
    );
    const { messages } = await t.action(testApi.saveInlineFiles, {
      threadId: sourceThreadId,
      kind: "file",
    });
    const fileId = messages[0].fileIds![0];
    await t.action(components.agent.messages.cloneThread, {
      sourceThreadId,
      targetThreadId,
    });
    await expect(
      t.query(components.agent.files.get, { fileId }),
    ).resolves.toMatchObject({ userId: "alice", refcount: 2 });
    await expect(
      t.query(components.agent.files.get, { fileId, requireUserId: "bob" }),
    ).resolves.toBeNull();
    await t.mutation(components.agent.messages.deleteByIds, {
      messageIds: [messages[0]._id],
    });
    await expect(
      t.query(components.agent.files.get, { fileId }),
    ).resolves.toMatchObject({ userId: "alice", refcount: 1 });
  });
});
