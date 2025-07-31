/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";
import type { Doc } from "./_generated/dataModel.js";
import type { PaginationResult } from "convex/server";
import { storeFile } from "../client/files.js";
import type { ActionCtx, AgentComponent } from "../client/types.js";

describe("files", () => {
  test("addFile increments refcount and does not create a new entry", async () => {
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

  test("getFilesToDelete paginates through files with refcount 0 one at a time", async () => {
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
      // Manually set refcount to 0
      await t.run(async (ctx) => {
        await ctx.db.patch(fileId, { refcount: 0 });
      });
      files.push(fileId);
    }
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


  test("blob consumption behavior - direct test", async () => {
    const originalContent = "Test content to check blob consumption";
    const blob = new Blob([originalContent], { type: "text/plain" });
    
    expect(blob.size).toBe(originalContent.length);
    
    const buffer = await blob.arrayBuffer();
    expect(buffer.byteLength).toBe(originalContent.length);
    expect(blob.size).toBe(originalContent.length);
    
    const buffer2 = await blob.arrayBuffer();
    expect(buffer2.byteLength).toBe(originalContent.length);
    expect(blob.size).toBe(originalContent.length);
  });

  test("blob consumption with hash calculation - simulates storeFile behavior", async () => {
    const originalContent = "Test content for hash calculation simulation";
    const blob = new Blob([originalContent], { type: "text/plain" });
    
    expect(blob.size).toBe(originalContent.length);
    
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    
    expect(blob.size).toBe(originalContent.length);
    expect(hash).toBeTruthy();
    expect(hash.length).toBe(64);
    
    const mockStore = async (blob: Blob) => {
      return { size: blob.size, id: "mock-storage-id" };
    };
    
    const storeResult = await mockStore(blob);
    expect(storeResult.size).toBe(originalContent.length);
  });
});
