/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { initConvexTest } from "./setup.test.js";

async function seedStream(t: ReturnType<typeof initConvexTest>) {
  const thread = await t.mutation(api.threads.createThread, {
    userId: "stream-files",
  });
  const threadId = thread._id as Id<"threads">;
  const streamId = await t.mutation(api.streams.create, {
    threadId,
    order: 0,
    stepOrder: 0,
    format: "UIMessageChunk",
  });
  const { fileId } = await t.mutation(api.files.addFile, {
    userId: "stream-files",
    storageId: "stream-storage",
    hash: "stream-hash",
    filename: "stream.txt",
  });
  return { threadId, streamId, fileId };
}

describe("streams", () => {
  test("stream file ownership flows from addDelta to the final message", async () => {
    const t = initConvexTest();
    const { threadId, streamId, fileId } = await seedStream(t);
    const url = "https://files.example/stream";

    await t.mutation(api.streams.addDelta, {
      streamId,
      start: 0,
      end: 1,
      parts: [{ type: "start" }],
      fileRefs: [{ url, fileId }],
    });
    await expect(t.query(api.files.get, { fileId })).resolves.toMatchObject({
      userId: "stream-files",
      refcount: 1,
    });

    // Repeating the same URL/file pair keeps a single reference.
    await t.mutation(api.streams.addDelta, {
      streamId,
      start: 1,
      end: 2,
      parts: [{ type: "text-delta", id: "text-1", delta: "hi" }],
      fileRefs: [{ url, fileId }],
    });
    await expect(t.query(api.files.get, { fileId })).resolves.toMatchObject({
      refcount: 1,
    });

    // A durable file can be referenced by more than one persisted URL.
    await t.mutation(api.streams.addDelta, {
      streamId,
      start: 2,
      end: 3,
      parts: [{ type: "text-delta", id: "text-1", delta: "there" }],
      fileRefs: [{ url: `${url}-alternate`, fileId }],
    });
    await expect(t.query(api.files.get, { fileId })).resolves.toMatchObject({
      refcount: 1,
    });

    const { fileId: otherFileId } = await t.mutation(api.files.addFile, {
      storageId: "other-storage",
      hash: "other-hash",
      filename: "other.txt",
    });
    await expect(
      t.mutation(api.streams.addDelta, {
        streamId,
        start: 3,
        end: 4,
        parts: [{ type: "finish" }],
        fileRefs: [{ url, fileId: otherFileId }],
      }),
    ).rejects.toThrow("Stream file URL maps to multiple files");
    await expect(
      t.query(api.files.get, { fileId: otherFileId }),
    ).resolves.toMatchObject({ refcount: 0 });
    expect(
      (await t.run((ctx) => ctx.db.get("streamingMessages", streamId)))
        ?.fileRefs,
    ).toEqual([{ url, fileId }, { url: `${url}-alternate`, fileId }]);

    await t.mutation(api.messages.addMessages, {
      threadId,
      messages: [
        {
          message: { role: "assistant", content: "done" },
          fileIds: [fileId],
        },
      ],
      finishStreamId: streamId,
    });
    await expect(t.query(api.files.get, { fileId })).resolves.toMatchObject({
      refcount: 1,
    });
    await expect(t.query(api.files.get, { fileId, requireUserId: "stream-files" })).resolves.toMatchObject({ refcount: 1 });
    const stream = await t.run((ctx) =>
      ctx.db.get("streamingMessages", streamId),
    );
    expect(stream?.state.kind).toBe("finished");
    expect(stream?.fileRefs).toBeUndefined();
  });
});
