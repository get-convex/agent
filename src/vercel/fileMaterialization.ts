import type { UIMessageChunk } from "ai";
import { MAX_FILE_SIZE, storeFile } from "./client/files.js";
import type { ActionCtx, AgentComponent, MutationCtx } from "./client/types.js";

export type MaterializedFileRef = { url: string; fileId: string };

/**
 * Replaces oversized inline files in persisted UI chunks with storage URLs.
 * Recovery uses the accompanying URL-to-file ownership references to attach
 * the stored files to the durable messages it creates.
 */
export async function materializeUIMessageChunkFiles(
  ctx: ActionCtx,
  component: AgentComponent,
  parts: readonly UIMessageChunk[],
  options: { userId?: string } = {},
): Promise<{ parts: UIMessageChunk[]; fileRefs: MaterializedFileRef[] }> {
  const fileRefs: MaterializedFileRef[] = [];
  const materialized = await Promise.all(
    parts.map(async (part): Promise<UIMessageChunk> => {
      if (part.type === "tool-output-available") {
        const result = await materializeCanonicalToolResultContentFiles(
          ctx,
          component,
          part.output,
          options,
        );
        fileRefs.push(...result.fileRefs);
        return { ...part, output: result.output };
      }
      if (part.type !== "file" && part.type !== "reasoning-file") {
        return { ...part };
      }
      const file = await materializeInlineFile(
        ctx,
        component,
        part.url,
        part.mediaType,
        options,
      );
      if (!file) {
        return { ...part };
      }
      fileRefs.push({ url: file.url, fileId: file.fileId });
      return { ...part, url: file.url };
    }),
  );
  return { parts: materialized, fileRefs };
}

/**
 * Materializes files in the AI SDK's canonical tool-result content output.
 * Other tool outputs are application-defined and intentionally remain opaque.
 */
export async function materializeCanonicalToolResultContentFiles(
  ctx: ActionCtx | MutationCtx,
  component: AgentComponent,
  output: unknown,
  options: { userId?: string } = {},
): Promise<{ output: unknown; fileRefs: MaterializedFileRef[] }> {
  if (!isCanonicalToolResultContent(output)) {
    return { output, fileRefs: [] };
  }
  const fileRefs: MaterializedFileRef[] = [];
  const value = await Promise.all(
    output.value.map(async (part): Promise<unknown> => {
      if (!isCanonicalToolResultFile(part)) return part;
      const file = await materializeInlineFile(
        ctx,
        component,
        part.data.type === "url"
          ? part.data.url
          : part.data.type === "data"
            ? part.data.data
            : new TextEncoder().encode(part.data.text),
        part.mediaType,
        { ...options, filename: part.filename },
      );
      if (!file) return part;
      fileRefs.push({ url: file.url, fileId: file.fileId });
      return {
        ...part,
        data: { type: "url", url: file.url },
      };
    }),
  );
  return { output: { ...output, value }, fileRefs };
}

async function materializeInlineFile(
  ctx: ActionCtx | MutationCtx,
  component: AgentComponent,
  data: unknown,
  mediaType: string,
  { filename, userId }: { filename?: string; userId?: string } = {},
) {
  const bytes = decodeInlineFileData(data);
  if (!bytes) return undefined;
  if (bytes.byteLength <= MAX_FILE_SIZE) return undefined;
  const blobBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const { file } = await storeFile(
    ctx,
    component,
    new Blob([blobBytes], {
      type: mediaType || "application/octet-stream",
    }),
    { filename, userId },
  );
  return file;
}

function isCanonicalToolResultContent(
  value: unknown,
): value is { type: "content"; value: unknown[] } {
  return (
    isRecord(value) && value.type === "content" && Array.isArray(value.value)
  );
}

function isCanonicalToolResultFile(value: unknown): value is {
  type: "file";
  data:
    | { type: "url"; url: string }
    | { type: "data"; data: unknown }
    | { type: "text"; text: string };
  mediaType: string;
  filename?: string;
} {
  return (
    isRecord(value) &&
    value.type === "file" &&
    typeof value.mediaType === "string" &&
    isRecord(value.data) &&
    ((value.data.type === "url" && typeof value.data.url === "string") ||
      value.data.type === "data" ||
      (value.data.type === "text" && typeof value.data.text === "string"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeInlineFileData(value: unknown): Uint8Array | undefined {
  if (typeof value === "string") {
    if (!value.startsWith("data:")) {
      // Remote and already-stored files are references, not inline payloads.
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
      return decodeBase64(value);
    }
    const separator = value.indexOf(",");
    if (separator === -1) return undefined;
    const metadata = value.slice(5, separator);
    const payload = value.slice(separator + 1);
    try {
      return metadata.includes(";base64")
        ? decodeBase64(payload)
        : new TextEncoder().encode(decodeURIComponent(payload));
    } catch {
      return undefined;
    }
  }
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return undefined;
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}
