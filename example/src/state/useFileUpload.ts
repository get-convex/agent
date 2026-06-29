import { useRef, useState } from "react";

import { userFacingError } from "../lib/format";
import { extractAttachmentText, localAttachmentId } from "../lib/upload";
import type { Id } from "../../convex/_generated/dataModel";
import type { UploadAttachment } from "./types";

export type AttachedFile = UploadAttachment & { _id: Id<"files"> };

export function isAttachable(file: UploadAttachment): file is AttachedFile {
  return (
    file._id !== undefined &&
    (file.uploadState === "ready" || file.uploadState === "metadataOnly")
  );
}

type SaveUploadedFileArgs = {
  sessionId: string;
  storageId: Id<"_storage">;
  filename: string;
  mediaType: string;
  size: number;
  extractedText?: string;
  extractionStatus: "extracted" | "metadataOnly" | "failed";
  textLength?: number;
  truncated: boolean;
};

export function useFileUpload({
  sessionId,
  generateUploadUrl,
  saveUploadedFile,
  setError,
}: {
  sessionId: string;
  generateUploadUrl: (args: { sessionId: string }) => Promise<string>;
  saveUploadedFile: (args: SaveUploadedFileArgs) => Promise<Id<"files">>;
  setError: (message: string | null) => void;
}) {
  const [attachments, setAttachments] = useState<UploadAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function removeAttachment(localId: string) {
    setAttachments((current) =>
      current.filter((file) => file.localId !== localId),
    );
  }

  function clearAttachments() {
    setAttachments([]);
  }

  function restoreAttachments(list: UploadAttachment[]) {
    setAttachments(list);
  }

  function readyFileRefs() {
    return attachments.filter(isAttachable).map((file) => file._id);
  }

  async function uploadFile(file: File) {
    const localId = localAttachmentId();
    const mediaType = file.type || "application/octet-stream";
    const sizeKb = Math.max(1, Math.ceil(file.size / 1024));
    setUploading(true);
    setError(null);
    setAttachments((current) => [
      ...current,
      {
        localId,
        filename: file.name,
        mediaType,
        size: file.size,
        uploadState: "reading",
      },
    ]);
    try {
      const extraction = await extractAttachmentText(file);
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.localId === localId
            ? { ...attachment, ...extraction, uploadState: "uploading" }
            : attachment,
        ),
      );
      const uploadUrl = await generateUploadUrl({ sessionId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mediaType },
        body: file,
      });
      if (!response.ok) throw new Error(`Upload failed with ${response.status}`);
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      const fileId = await saveUploadedFile({
        sessionId,
        storageId,
        filename: file.name,
        mediaType,
        size: file.size,
        extractedText: extraction.extractedText,
        extractionStatus: extraction.extractionStatus,
        textLength: extraction.textLength,
        truncated: extraction.truncated,
      });
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.localId === localId
            ? {
                ...attachment,
                _id: fileId,
                summary:
                  extraction.extractionStatus === "extracted"
                    ? `${file.name} (${sizeKb} KB) with ${extraction.textLength ?? 0} characters ready.`
                    : `${file.name} (${sizeKb} KB) metadata only.`,
                uploadState:
                  extraction.extractionStatus === "extracted"
                    ? "ready"
                    : "metadataOnly",
              }
            : attachment,
        ),
      );
    } catch (nextError) {
      const message = userFacingError(nextError);
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.localId === localId
            ? { ...attachment, uploadState: "error", error: message }
            : attachment,
        ),
      );
      setError(message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return {
    attachments,
    uploading,
    fileInputRef,
    uploadFile,
    removeAttachment,
    clearAttachments,
    restoreAttachments,
    readyFileRefs,
  };
}
