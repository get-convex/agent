import type {
  Message,
  MessageContentParts,
  MessageDoc,
  MessageWithMetadata,
  Usage,
} from "../validators.js";

/**
 * Agent's canonical persisted message format.
 *
 * Provider adapters translate this shape at their boundary.
 */
export type AgentMessage = Message;

/** A content part from Agent's canonical persisted message format. */
export type AgentMessagePart = MessageContentParts;

/**
 * Agent's canonical persisted message document.
 *
 * It includes the complete message and provider metadata stored by Agent.
 */
export type AgentMessageDoc = MessageDoc;

/** Agent's canonical input shape for saving a message with metadata. */
export type AgentMessageInput = MessageWithMetadata;

/** Agent's canonical persisted token-usage format. */
export type AgentUsage = Usage;
