/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";
import type { Doc } from "./_generated/dataModel.js";
import type { PaginationResult } from "convex/server";

describe("files", () => {
  afterEach(() => vi.useRealTimers());
  test("addFile registers and reuses a file without acquiring ownership", async () => {
    const t = convexTest(schema, modules);
    const storageId = "storage-1";
    const hash = "hash-1";
    const filename = "file.txt";
    // Add the file for the first time
    const { fileId, storageId: returnedStorageId } = await t.mutation(
      api.files.addFile,
      {
        storageId,
        hash,
        filename,
        mimeType: "text/plain",
      },
    );
    expect(fileId).toBeTruthy();
    expect(returnedStorageId).toBe(storageId);
    // Add the same file again
    const { fileId: fileId2 } = await t.mutation(api.files.addFile, {
      storageId,
      hash,
      filename,
      mimeType: "text/plain",
    });
    expect(fileId2).toBe(fileId);
    await expect(t.query(api.files.get, { fileId })).resolves.toMatchObject({
      refcount: 0,
    });
    // Add the same file with a different filename (should create a new entry)
    const { fileId: fileId3 } = await t.mutation(api.files.addFile, {
      storageId,
      hash,
      filename: "other.txt",
      mimeType: "text/plain",
    });
    expect(fileId3).not.toBe(fileId);
    // Add the same file with undefined filename (should create a new entry)
    const { fileId: fileId4 } = await t.mutation(api.files.addFile, {
      storageId,
      hash,
      filename: undefined,
      mimeType: "text/plain",
    });
    expect(fileId4).not.toBe(fileId);
  });

  test("useExistingFile only matches files with the same hash and filename", async () => {
    const t = convexTest(schema, modules);
    const storageId = "storage-2";
    const hash = "hash-2";
    const filename = "file2.txt";
    // Add a file
    const { fileId } = await t.mutation(api.files.addFile, {
      storageId,
      hash,
      filename,
      mimeType: "text/plain",
    });
    // Should match
    const fileId2 = await t.mutation(api.files.useExistingFile, {
      hash,
      filename,
    });
    expect(fileId2?.fileId).toBe(fileId);
    // Should not match with different filename
    const fileId3 = await t.mutation(api.files.useExistingFile, {
      hash,
      filename: "other2.txt",
    });
    expect(fileId3).toBeNull();
    // Should not match with undefined filename
    const fileId4 = await t.mutation(api.files.useExistingFile, {
      hash,
    });
    expect(fileId4).toBeNull();
  });

  test("reuses a legacy file row with no media type", async () => {
    const t = convexTest(schema, modules);
    const fileId = await t.run((ctx) =>
      ctx.db.insert("files", {
        storageId: "legacy-storage",
        hash: "legacy-hash",
        filename: "legacy.txt",
        refcount: 0,
        lastTouchedAt: Date.now(),
      }),
    );

    await expect(
      t.mutation(api.files.addFile, {
        storageId: "new-storage",
        hash: "legacy-hash",
        filename: "legacy.txt",
        mediaType: "text/plain",
      }),
    ).resolves.toEqual({ fileId, storageId: "legacy-storage" });
  });

  test("getFilesToDelete paginates through files with refcount 0 one at a time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    // Add 3 files with refcount 0
    const files = [];
    for (let i = 0; i < 3; i++) {
      const { fileId } = await t.mutation(api.files.addFile, {
        storageId: `storage-del-${i}`,
        hash: `hash-del-${i}`,
        filename: `file-del-${i}.txt`,
        mimeType: "text/plain",
      });
      files.push(fileId);
    }
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    // Paginate through files to delete one at a time
    let cursor: string | null = null;
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { page, continueCursor, isDone }: PaginationResult<Doc<"files">> =
        await t.query(api.files.getFilesToDelete, {
          paginationOpts: {
            numItems: 1,
            cursor,
          },
        });
      expect(page.length).toBe(1);
      seen.push(page[0]._id);
      cursor = continueCursor;
      expect(isDone).toBe(false);
    }
    const { page, isDone } = await t.query(api.files.getFilesToDelete, {
      paginationOpts: {
        numItems: 1,
        cursor,
      },
    });
    expect(page.length).toBe(0);
    expect(isDone).toBe(true);
    // All fileIds should be seen
    expect(seen.sort()).toEqual(files.sort());
  });

  test("does not expose or delete freshly registered files", async () => {
    const t = convexTest(schema, modules);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fileId } = await t.mutation(api.files.addFile, {
      storageId: "storage-fresh",
      hash: "hash-fresh",
      filename: "fresh.txt",
      mimeType: "text/plain",
    });

    await expect(
      t.query(api.files.getFilesToDelete, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).resolves.toMatchObject({ page: [] });
    await expect(
      t.mutation(api.files.deleteFiles, { fileIds: [fileId] }),
    ).resolves.toEqual([]);
    await expect(t.query(api.files.get, { fileId })).resolves.not.toBeNull();
    error.mockRestore();
  });

  test("refreshes a cache hit before the cleanup grace period expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    const { fileId } = await t.mutation(api.files.addFile, {
      storageId: "storage-cache-hit",
      hash: "cache-hit-hash",
      filename: "cache-hit.txt",
      mediaType: "text/plain",
    });

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 60 * 1000);
    await expect(
      t.mutation(api.files.useExistingFile, {
        hash: "cache-hit-hash",
        filename: "cache-hit.txt",
        mediaType: "text/plain",
      }),
    ).resolves.toMatchObject({ fileId });

    vi.advanceTimersByTime(60 * 1000);
    await expect(
      t.query(api.files.getFilesToDelete, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).resolves.toMatchObject({ page: [] });
  });
});

describe("file user ownership", () => {
  afterEach(() => vi.useRealTimers());

  test("deduplication and checked reads isolate users and the unscoped pool", async () => {
    const t = convexTest(schema, modules);
    const files = [];
    for (const userId of [undefined, "alice", "bob"]) {
      const args = {
        userId,
        hash: "same",
        filename: "same.pdf",
        mediaType: "application/pdf",
      };
      const file = await t.mutation(api.files.addFile, {
        ...args,
        storageId: `storage-${userId}`,
      });
      files.push(file);
      await expect(
        t.mutation(api.files.useExistingFile, args),
      ).resolves.toEqual(file);
      await expect(
        t.mutation(api.files.addFile, { ...args, storageId: "losing-upload" }),
      ).resolves.toEqual(file);
      await expect(
        t.query(api.files.get, { fileId: file.fileId }),
      ).resolves.toMatchObject({
        storageId: `storage-${userId}`,
        refcount: 0,
      });
    }
    expect(new Set(files.map((file) => file.fileId)).size).toBe(3);
    await expect(
      t.mutation(api.files.useExistingFile, {
        userId: "charlie",
        hash: "same",
        filename: "same.pdf",
      }),
    ).resolves.toBeNull();
    for (const [index, file] of files.entries()) {
      const checked = await t.query(api.files.get, {
        fileId: file.fileId,
        requireUserId: "alice",
      });
      if (index === 1) expect(checked?.userId).toBe("alice");
      else expect(checked).toBeNull();
    }
    await t.mutation(api.files.deleteFiles, {
      fileIds: [files[1].fileId],
      force: true,
    });
    await expect(
      t.query(api.files.get, {
        fileId: files[1].fileId,
        requireUserId: "alice",
      }),
    ).resolves.toBeNull();
  });

  test("scoped lookups preserve normalized media, legacy mimeType, and filename matching", async () => {
    const t = convexTest(schema, modules);
    const args = { userId: "alice", hash: "same", filename: "same" };
    await t.mutation(api.files.addFile, {
      ...args,
      storageId: "pdf",
      mediaType: "application/pdf",
    });
    const text = await t.mutation(api.files.addFile, {
      ...args,
      storageId: "text",
      mimeType: " Text/Plain ",
    });
    // The first row has a different media type; both entry points must keep looking.
    await expect(
      t.mutation(api.files.useExistingFile, {
        ...args,
        mediaType: " TEXT/PLAIN ",
      }),
    ).resolves.toEqual(text);
    await expect(
      t.mutation(api.files.addFile, {
        ...args,
        storageId: "new",
        mediaType: "text/plain",
      }),
    ).resolves.toEqual(text);
    await expect(
      t.mutation(api.files.useExistingFile, { ...args, filename: undefined }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.files.useExistingFile, { ...args, userId: undefined }),
    ).resolves.toBeNull();

    const legacy = await t.run((ctx) =>
      ctx.db.insert("files", {
        userId: "alice",
        storageId: "legacy",
        hash: "legacy",
        mimeType: "TEXT/PLAIN",
        refcount: 0,
        lastTouchedAt: Date.now(),
      }),
    );
    await expect(
      t.mutation(api.files.useExistingFile, {
        userId: "alice",
        hash: "legacy",
        mediaType: "text/plain",
      }),
    ).resolves.toMatchObject({ fileId: legacy });
    const unknown = await t.mutation(api.files.addFile, {
      userId: "alice",
      storageId: "unknown",
      hash: "unknown",
    });
    await expect(
      t.mutation(api.files.addFile, {
        userId: "alice",
        storageId: "new-unknown",
        hash: "unknown",
        mediaType: "image/png",
      }),
    ).resolves.toEqual(unknown);
  });

  test("a fresh zero-reference alias protects a shared blob until its own grace expires", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const old = await t.mutation(api.files.addFile, {
      userId: "alice",
      storageId: "shared",
      hash: "same",
    });
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    const fresh = await t.mutation(api.files.addFile, {
      userId: "bob",
      storageId: "shared",
      hash: "same",
    });
    await expect(
      t.mutation(api.files.deleteFilesWithStorageIds, {
        fileIds: [old.fileId],
      }),
    ).resolves.toEqual({
      deletedFileIds: [old.fileId],
      storageIdsToDelete: [],
    });
    expect(
      await t.query(api.files.get, { fileId: fresh.fileId }),
    ).not.toBeNull();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await expect(
      t.mutation(api.files.deleteFilesWithStorageIds, {
        fileIds: [fresh.fileId, fresh.fileId],
      }),
    ).resolves.toEqual({
      deletedFileIds: [fresh.fileId],
      storageIdsToDelete: ["shared"],
    });
  });

  test("force never returns a blob still referenced by another file record", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(api.files.addFile, {
      userId: "alice",
      storageId: "shared",
      hash: "same",
    });
    const second = await t.mutation(api.files.addFile, {
      userId: "bob",
      storageId: "shared",
      hash: "same",
    });
    await t.mutation(api.files.copyFile, { fileId: second.fileId });
    await expect(
      t.mutation(api.files.deleteFilesWithStorageIds, {
        fileIds: [first.fileId],
        force: true,
      }),
    ).resolves.toEqual({
      deletedFileIds: [first.fileId],
      storageIdsToDelete: [],
    });
    await expect(
      t.query(api.files.get, { fileId: second.fileId }),
    ).resolves.toMatchObject({ userId: "bob", refcount: 1 });
    await expect(
      t.mutation(api.files.deleteFilesWithStorageIds, {
        fileIds: [second.fileId],
        force: true,
      }),
    ).resolves.toEqual({
      deletedFileIds: [second.fileId],
      storageIdsToDelete: ["shared"],
    });
  });

  test("deleting all eligible aliases returns their storage ID once", async () => {
    const t = convexTest(schema, modules);
    const files = await Promise.all(
      ["a", "b"].map((filename) =>
        t.mutation(api.files.addFile, {
          storageId: "shared",
          hash: "same",
          filename,
        }),
      ),
    );
    const fileIds = files.map((file) => file.fileId);
    await expect(
      t.mutation(api.files.deleteFilesWithStorageIds, { fileIds, force: true }),
    ).resolves.toEqual({
      deletedFileIds: fileIds,
      storageIdsToDelete: ["shared"],
    });
  });
});
