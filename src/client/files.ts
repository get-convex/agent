import type { FilePart, ImagePart } from "ai";
import type { Id } from "../component/_generated/dataModel.js";
import type {
  ActionCtx,
  AgentComponent,
  QueryCtx,
  RunMutationCtx,
} from "./types.js";

export const MAX_FILE_SIZE = 1024 * 64;

type File = {
  url: string;
  fileId: string;
  storageId: Id<"_storage">;
  hash: string;
  filename: string | undefined;
};

/**
 * Store a file in the file storage and return the URL and fileId.
 * @param ctx A ctx object from an action.
 * @param component The agent component.
 * @param blob The blob to store.
 * @param filename The filename to store.
 * @param sha256 The sha256 hash of the file. If not provided, it will be
 *   computed. However, to ensure no corruption during transfer, you can
 *   calculate this on the client to enforce integrity.
 * @returns The URL, fileId, and storageId of the stored file.
 */
export async function storeFile(
  ctx: ActionCtx | RunMutationCtx,
  component: AgentComponent,
  blob: Blob,
  filename?: string,
  sha256?: string,
): Promise<{
  file: File;
  filePart: FilePart;
  imagePart: ImagePart | undefined;
}> {
  if (!("runAction" in ctx) || !("storage" in ctx)) {
    throw new Error(
      "You're trying to save a file that's too large in a mutation / workflow. " +
        "You can store the file in file storage from an action first, then pass a URL instead. " +
        "To have the agent component track the file, you can use `saveFile` from an action then use the fileId with getFile in the mutation. " +
        "Read more in the docs.",
    );
  }
  const hash =
    sha256 ||
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await blob.slice().arrayBuffer()),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const reused = await ctx.runMutation(component.files.useExistingFile, {
    hash,
    filename,
  });
  if (reused) {
    const url = (await ctx.storage.getUrl(reused.storageId))!;
    return {
      ...getParts(url, blob.type, filename),
      file: {
        url,
        fileId: reused.fileId,
        storageId: reused.storageId as Id<"_storage">,
        hash,
        filename,
      },
    };
  }
  const newStorageId = await ctx.storage.store(blob);
  if (sha256) {
    const metadata = await ctx.storage.getMetadata(newStorageId);
    if (metadata?.sha256 !== sha256) {
      throw new Error("Hash mismatch: " + metadata?.sha256 + " != " + sha256);
    }
  }
  const { fileId, storageId } = await ctx.runMutation(component.files.addFile, {
    storageId: newStorageId,
    hash,
    filename,
    mimeType: blob.type,
  });
  const url = (await ctx.storage.getUrl(storageId as Id<"_storage">))!;
  if (storageId !== newStorageId) {
    // We're re-using another file's storageId
    // Because we try to reuse the file above, this should be very very rare
    // and only in the case of racing to check then store the file.
    await ctx.storage.delete(newStorageId);
  }
  return {
    ...getParts(url, blob.type, filename),
    file: {
      url,
      fileId,
      storageId: storageId as Id<"_storage">,
      hash,
      filename,
    },
  };
}

/**
 * Get file metadata from the component.
 * This also returns filePart (and imagePart if the file is an image),
 * which are useful to construct a CoreMessage like
 * ```ts
 * const { filePart, imagePart } = await getFile(ctx, components.agent, fileId);
 * const message: UserMessage = {
 *   role: "user",
 *   content: [imagePart ?? filePart],
 * };
 * ```
 * @param ctx A ctx object from an action or query.
 * @param component The agent component, usually `components.agent`.
 * @param fileId The fileId of the file to get.
 * @returns The file metadata and content parts.
 */
export async function getFile(
  ctx: ActionCtx | QueryCtx,
  component: AgentComponent,
  fileId: string,
) {
  const file = await ctx.runQuery(component.files.get, { fileId });
  if (!file) {
    throw new Error(`File not found in component: ${fileId}`);
  }
  const url = await ctx.storage.getUrl(file.storageId as Id<"_storage">);
  if (!url) {
    throw new Error(`File not found in storage: ${file.storageId}`);
  }
  return {
    ...getParts(url, file.mimeType, file.filename),
    file: {
      fileId,
      url,
      storageId: file.storageId as Id<"_storage">,
      hash: file.hash,
      filename: file.filename,
    },
  };
}

function getParts(
  url: string,
  mimeType: string,
  filename: string | undefined,
): {
  filePart: FilePart;
  imagePart: ImagePart | undefined;
} {
  const filePart: FilePart = {
    type: "file",
    data: new URL(url),
    mimeType,
    filename,
  };
  const imagePart: ImagePart | undefined = mimeType.startsWith("image/")
    ? {
        type: "image",
        image: new URL(url),
        mimeType,
      }
    : undefined;
  return { filePart, imagePart };
}
