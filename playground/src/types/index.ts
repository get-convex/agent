import {
  ContextOptions,
  MessageDoc,
  StorageOptions,
  ThreadDoc,
} from "@convex-dev/agent";

export interface Agent {
  name: string;
  instructions: string | undefined;
  contextOptions: ContextOptions | undefined;
  storageOptions: StorageOptions | undefined;
  maxRetries: number | undefined;
  tools: string[];
}

export interface User {
  _id: string;
  name: string;
}

export type Thread = ThreadDoc & {
  lastAgentName?: string;
  latestMessage?: string;
  lastMessageAt?: number;
};

export interface ToolCall {
  id: string;
  type: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  returnValue?: any;
}

export type Message = MessageDoc;

export type ContextMessage = MessageDoc & {
  vectorSearchRank?: number;
  textSearchRank?: number;
  hybridSearchRank?: number;
};
