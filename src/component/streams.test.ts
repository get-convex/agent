/// <reference types="vite/client" />

import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { initConvexTest } from "./setup.test.js";

afterEach(() => vi.useRealTimers());

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
    const stream = await t.run((ctx) =>
      ctx.db.get("streamingMessages", streamId),
    );
    expect(stream?.state.kind).toBe("finished");
    expect(stream?.fileRefs).toBeUndefined();
  });

  test("bulk deletion preserves global stream order across status lanes", async () => {
    vi.useFakeTimers();

    const t = initConvexTest();
    const thread = await t.mutation(api.threads.createThread, {
      userId: "stream-cleanup",
    });
    const threadId = thread._id as Id<"threads">;
    const earlyStreamId = await t.run(async (ctx) => {
      const streamId = await ctx.db.insert("streamingMessages", {
        threadId,
        order: 1,
        stepOrder: 0,
        format: "UIMessageChunk",
        state: { kind: "streaming", lastHeartbeat: Date.now() },
      });
      await ctx.db.insert("streamingMessages", {
        threadId,
        order: 9,
        stepOrder: 0,
        format: "UIMessageChunk",
        state: { kind: "aborted", reason: "retained regeneration" },
      });
      await ctx.db.insert("streamDeltas", {
        streamId,
        start: 0,
        end: 1,
        parts: [{ type: "text-start", id: "text" }],
      });
      return streamId;
    });

    await t.mutation(api.streams.deleteAllStreamsForThreadIdAsync, {
      threadId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(
      await t.query(api.streams.list, {
        threadId,
        statuses: ["streaming", "finished", "aborted"],
      }),
    ).toEqual([]);
    expect(
      await t.query(api.streams.listDeltas, {
        threadId,
        cursors: [{ streamId: earlyStreamId, cursor: 0 }],
      }),
    ).toEqual([]);
  });
});
