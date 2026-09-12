import type {
  AssistantContent,
  FilePart,
  ImagePart,
  ModelMessage,
  UserContent,
} from "ai";
import type { Id } from "../../component/_generated/dataModel.js";
import type {
  ActionCtx,
  AgentComponent,
  MutationCtx,
  QueryCtx,
} from "./types.js";
import type { Message } from "../../validators.js";
import { assert } from "convex-helpers";
import type { StorageReader } from "convex/server";

export const MAX_FILE_SIZE = 1024 * 64;

type File = {
  userId?: string;
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
 * @param args.filename The filename to store.
 * @param args.userId Owner supplied by the app. Deduplication stays within this
 *   user's files. Omit for the shared legacy/unscoped pool.
 * @param args.sha256 The sha256 hash of the file. If not provided, it will be
 *   computed. However, to ensure no corruption during transfer, you can
 *   calculate this on the client to enforce integrity.
 * @returns The URL, fileId, and storageId of the stored file.
 */
export async function storeFile(
  ctx: ActionCtx | MutationCtx,
  component: AgentComponent,
  blob: Blob,
  {
    filename,
    sha256,
    userId,
  }: { filename?: string; sha256?: string; userId?: string } = {},
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
    userId,
    hash,
    filename,
    mediaType: blob.type || undefined,
  });
  if (reused) {
    const url = await ctx.storage.getUrl(reused.storageId);
    if (!url) {
      throw new Error(`File not found in storage: ${reused.storageId}`);
    }
    return {
      ...getParts(url, blob.type, filename),
      file: {
        userId,
        url,
        fileId: reused.fileId,
        storageId: reused.storageId as Id<"_storage">,
        hash,
        filename,
      },
    };
  }
  const newStorageId = await ctx.storage.store(blob);
  let newStorageRegistered = false;
  let cleanupAttempted = false;
  const cleanupNewStorage = async () => {
    if (cleanupAttempted) return;
    cleanupAttempted = true;
    await ctx.storage.delete(newStorageId);
  };
  try {
    if (sha256) {
      const metadata = await ctx.storage.getMetadata(newStorageId);
      if (metadata?.sha256 !== sha256) {
        throw new Error("Hash mismatch: " + metadata?.sha256 + " != " + sha256);
      }
    }
    const { fileId, storageId } = await ctx.runMutation(
      component.files.addFile,
      {
        userId,
        storageId: newStorageId,
        hash,
        filename,
        mediaType: blob.type,
      },
    );
    newStorageRegistered = storageId === newStorageId;
    // A competing request can win after useExistingFile but before addFile.
    // Delete our losing blob before the existing file's URL is read, so a
    // failed getUrl cannot leave the raw object orphaned.
    if (!newStorageRegistered) {
      await cleanupNewStorage();
    }
    const url = await ctx.storage.getUrl(storageId as Id<"_storage">);
    if (!url) {
      throw new Error(`File not found in storage: ${storageId}`);
    }
    return {
      ...getParts(url, blob.type, filename),
      file: {
        userId,
        url,
        fileId,
        storageId: storageId as Id<"_storage">,
        hash,
        filename,
      },
    };
  } catch (error) {
    if (!newStorageRegistered && !cleanupAttempted) {
      await cleanupNewStorage().catch(() => {});
    }
    throw error;
  }
}

/**
 * Get file metadata from the component.
 * This also returns filePart (and imagePart if the file is an image),
 * which are useful to construct a ModelMessage like
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
 * @param options.requireUserId Require this owner before resolving a storage
 *   URL. The app must authenticate the caller before supplying their user ID.
 *   Ownerless legacy files fail this check. Omit options only after applying
 *   your own access policy in trusted server code.
 * @returns The file metadata and content parts.
 */
export async function getFile(
  ctx: ActionCtx | (QueryCtx & { storage: StorageReader }),
  component: AgentComponent,
  fileId: string,
  options?: { requireUserId: string },
) {
  if (options !== undefined && typeof options.requireUserId !== "string") {
    throw new Error("requireUserId must be a string");
  }
  const file = await ctx.runQuery(component.files.get, {
    fileId,
    ...(options ? { requireUserId: options.requireUserId } : {}),
  });
  if (!file) {
    throw new Error(`File not found in component: ${fileId}`);
  }
  const url = await ctx.storage.getUrl(file.storageId as Id<"_storage">);
  if (!url) {
    throw new Error(`File not found in storage: ${file.storageId}`);
  }
  // Support both mediaType (preferred) and mimeType (deprecated)
  const mediaType = file.mediaType ?? file.mimeType ?? "";
  return {
    ...getParts(url, mediaType, file.filename),
    file: {
      userId: file.userId,
      fileId,
      url,
      storageId: file.storageId as Id<"_storage">,
      hash: file.hash,
      filename: file.filename,
    },
  };
}

/** Resolve file ownership before serialization; this does not authorize access. */
export async function resolveFileUserId(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  component: AgentComponent,
  { userId, threadId }: { userId?: string | null; threadId?: string },
) {
  return (
    userId ??
    (threadId
      ? (await ctx.runQuery(component.threads.getThread, { threadId }))?.userId
      : undefined)
  );
}

function getParts(
  url: string,
  mediaType: string,
  filename: string | undefined,
): { filePart: FilePart; imagePart: ImagePart | undefined } {
  const filePart: FilePart = {
    type: "file",
    data: new URL(url),
    mediaType,
    filename,
  };
  const imagePart: ImagePart | undefined = mediaType.startsWith("image/")
    ? { type: "image", image: new URL(url), mediaType }
    : undefined;
  return { filePart, imagePart };
}

/**
 * Check if a URL points to localhost
 */
function isLocalhostUrl(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "0.0.0.0"
  );
}

/**
 * Download a file from a URL
 */
async function downloadFile(url: URL): Promise<ArrayBuffer> {
  // Fetch the file
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }

  return await response.arrayBuffer();
}

/**
 * Process messages to inline file and image URLs that point to localhost
 * by converting them to base64. This solves the problem of LLMs not being
 * able to access localhost URLs.
 */
export async function inlineMessagesFiles<T extends ModelMessage | Message>(
  messages: T[],
): Promise<T[]> {
  // Process each message to convert localhost URLs to base64
  return Promise.all(
    messages.map(async (message): Promise<T> => {
      if (
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content === "string" ||
        !Array.isArray(message.content)
      ) {
        return message;
      }

      const processedContent = await Promise.all(
        message.content.map(async (part) => {
          if (part.type === "image" && part.image instanceof URL) {
            assert(
              message.role === "user",
              "Images can only be in user messages",
            );
            if (isLocalhostUrl(part.image)) {
              const imageData = await downloadFile(part.image);
              return { ...part, image: imageData } as ImagePart;
            }
          }

          // Handle file parts
          if (part.type === "file" && part.data instanceof URL) {
            if (isLocalhostUrl(part.data)) {
              const fileData = await downloadFile(part.data);
              return { ...part, data: fileData } as FilePart;
            }
          }

          return part;
        }),
      );
      if (message.role === "user") {
        return { ...message, content: processedContent as UserContent };
      } else {
        return { ...message, content: processedContent as AssistantContent };
      }
    }),
  );
}
