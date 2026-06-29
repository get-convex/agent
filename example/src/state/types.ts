import type {
  AgentMessageDoc,
  AgentMessagePart,
  AgentRun,
  AgentRunEvent,
  AgentToolCall,
} from "@convex-dev/agent";
import type { Id } from "../../convex/_generated/dataModel";

export type {
  AgentMessageDoc,
  AgentMessagePart,
  AgentRun,
  AgentRunEvent,
};

export type ToolCall = AgentToolCall;

export type SupportCase = {
  threadId: string;
  title: string;
  status: "open" | "drafting" | "needsApproval" | "resolved";
  lastRunId?: string;
  createdAt: number;
  updatedAt: number;
};

export type FileDoc = {
  _id: Id<"files">;
  filename: string;
  mediaType: string;
  summary: string;
  extractedText?: string;
  extractionStatus?: "extracted" | "metadataOnly" | "failed";
  textLength?: number;
  truncated?: boolean;
  url?: string;
  storageId?: Id<"_storage">;
  size?: number;
};

export type ActivityRow = {
  label: string;
  status: string;
  timestamp?: number;
  detail?: unknown;
};

export type StreamState = {
  state: "idle" | "connecting" | "live" | "closed" | "error";
  headers: Record<string, string>;
  chunks: string[];
  error?: string;
};

export type UploadAttachment = Partial<FileDoc> & {
  localId: string;
  filename: string;
  mediaType: string;
  size: number;
  uploadState: "reading" | "uploading" | "ready" | "metadataOnly" | "error";
  error?: string;
};

export type LiveDraft = {
  runId: string;
  messageId?: string;
  createdAt: number;
  status: "connecting" | "waiting" | "streaming" | "closed" | "stopped" | "error";
  text: string;
  reasoning: string;
  sources: Array<{
    id: string;
    title?: string;
    url?: string;
  }>;
  files: Array<{
    fileId?: string;
    filename?: string;
    mediaType?: string;
    url?: string;
  }>;
  error?: string;
};
