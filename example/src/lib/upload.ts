export const MAX_FILE_CONTEXT_CHARS = 24_000;

const TEXT_FILE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export function localAttachmentId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function fileExtension(filename: string) {
  const match = /\.[^.]+$/u.exec(filename.toLowerCase());
  return match?.[0] ?? "";
}

export function extensionBadge(filename: string) {
  const extension = filename.split(".").pop();
  if (!extension || extension === filename) return "file";
  return extension.slice(0, 5).toLowerCase();
}

export function isTextLikeFile(file: File) {
  if (file.type.startsWith("text/") || file.type === "application/json") {
    return true;
  }
  return TEXT_FILE_EXTENSIONS.has(fileExtension(file.name));
}

export async function extractAttachmentText(file: File) {
  if (!isTextLikeFile(file)) {
    return {
      extractionStatus: "metadataOnly" as const,
      extractedText: undefined,
      textLength: undefined,
      truncated: false,
    };
  }
  try {
    const text = await file.text();
    const truncated = text.length > MAX_FILE_CONTEXT_CHARS;
    return {
      extractionStatus: "extracted" as const,
      extractedText: truncated ? text.slice(0, MAX_FILE_CONTEXT_CHARS) : text,
      textLength: text.length,
      truncated,
    };
  } catch {
    return {
      extractionStatus: "failed" as const,
      extractedText: undefined,
      textLength: undefined,
      truncated: false,
    };
  }
}

export function attachmentStatusLabel(file: {
  uploadState: "reading" | "uploading" | "ready" | "metadataOnly" | "error";
  truncated?: boolean;
}) {
  if (file.uploadState === "reading") return "Reading";
  if (file.uploadState === "uploading") return "Uploading";
  if (file.uploadState === "metadataOnly") return "Metadata only";
  if (file.uploadState === "error") return "Failed";
  if (file.truncated) return "Text ready, truncated";
  return "Text ready";
}
