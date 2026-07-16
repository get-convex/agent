/**
 * Package entry point for the AI SDK 6 Agent API.
 *
 * The implementation lives behind the internal Vercel adapter boundary while
 * existing `@convex-dev/agent` imports continue to work unchanged.
 */

export * from "../vercel/index.js";
export type {
  AgentMessage,
  AgentMessageDoc,
  AgentMessageInput,
  AgentMessagePart,
  AgentUsage,
} from "../core/index.js";
