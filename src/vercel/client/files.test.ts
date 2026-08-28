/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { storeFile } from "./files.js";

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
