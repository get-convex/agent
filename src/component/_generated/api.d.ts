/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys from "../apiKeys.js";
import type * as files from "../files.js";
import type * as messages from "../messages.js";
import type * as streams from "../streams.js";
import type * as threads from "../threads.js";
import type * as triggers from "../triggers.js";
import type * as users from "../users.js";
import type * as vector_index from "../vector/index.js";
import type * as vector_tables from "../vector/tables.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  files: typeof files;
  messages: typeof messages;
  streams: typeof streams;
  threads: typeof threads;
  triggers: typeof triggers;
  users: typeof users;
  "vector/index": typeof vector_index;
  "vector/tables": typeof vector_tables;
}>;
export type Mounts = {
  apiKeys: {
    destroy: FunctionReference<
      "mutation",
      "public",
      { apiKey?: string; name?: string },
      | "missing"
      | "deleted"
      | "name mismatch"
      | "must provide either apiKey or name"
    >;
    issue: FunctionReference<"mutation", "public", { name?: string }, string>;
    validate: FunctionReference<"query", "public", { apiKey: string }, boolean>;
  };
  files: {
    addFile: FunctionReference<
      "mutation",
      "public",
      { filename?: string; hash: string; mimeType: string; storageId: string },
      { fileId: string; storageId: string }
    >;
    copyFile: FunctionReference<"mutation", "public", { fileId: string }, null>;
    deleteFiles: FunctionReference<
      "mutation",
      "public",
      { fileIds: Array<string>; force?: boolean },
      Array<string>
    >;
    get: FunctionReference<
      "query",
      "public",
      { fileId: string },
      null | {
        _creationTime: number;
        _id: string;
        filename?: string;
        hash: string;
        lastTouchedAt: number;
        mimeType: string;
        refcount: number;
        storageId: string;
      }
    >;
    getFilesToDelete: FunctionReference<
      "query",
      "public",
      {
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _creationTime: number;
          _id: string;
          filename?: string;
          hash: string;
          lastTouchedAt: number;
          mimeType: string;
          refcount: number;
          storageId: string;
        }>;
      }
    >;
    useExistingFile: FunctionReference<
      "mutation",
      "public",
      { filename?: string; hash: string },
      null | { fileId: string; storageId: string }
    >;
  };
  messages: {
    addMessages: FunctionReference<
      "mutation",
      "public",
      {
        agentName?: string;
        embeddings?: {
          dimension:
            | 128
            | 256
            | 512
            | 768
            | 1024
            | 1408
            | 1536
            | 2048
            | 3072
            | 4096;
          model: string;
          vectors: Array<Array<number> | null>;
        };
        failPendingSteps?: boolean;
        messages: Array<{
          error?: string;
          fileIds?: Array<string>;
          finishReason?:
            | "stop"
            | "length"
            | "content-filter"
            | "tool-calls"
            | "error"
            | "other"
            | "unknown";
          message:
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          signature?: string;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                      | {
                          args?: any;
                          experimental_content?: Array<
                            | { text: string; type: "text" }
                            | { data: string; mimeType?: string; type: "image" }
                          >;
                          isError?: boolean;
                          output?:
                            | { type: "text"; value: string }
                            | { type: "json"; value: any }
                            | { type: "error-text"; value: string }
                            | { type: "error-json"; value: any }
                            | {
                                type: "content";
                                value: Array<
                                  | { text: string; type: "text" }
                                  | {
                                      data: string;
                                      mediaType: string;
                                      type: "media";
                                    }
                                >;
                              };
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          result?: any;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-result";
                        }
                      | {
                          id: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "url";
                          title: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "document";
                          title: string;
                          type: "source";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "assistant";
              }
            | {
                content: Array<{
                  args?: any;
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  isError?: boolean;
                  output?:
                    | { type: "text"; value: string }
                    | { type: "json"; value: any }
                    | { type: "error-text"; value: string }
                    | { type: "error-json"; value: any }
                    | {
                        type: "content";
                        value: Array<
                          | { text: string; type: "text" }
                          | { data: string; mediaType: string; type: "media" }
                        >;
                      };
                  providerExecuted?: boolean;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  result?: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                providerOptions?: Record<string, Record<string, any>>;
                role: "tool";
              }
            | {
                content: string;
                providerOptions?: Record<string, Record<string, any>>;
                role: "system";
              };
          model?: string;
          provider?: string;
          providerMetadata?: Record<string, Record<string, any>>;
          reasoning?: string;
          reasoningDetails?: Array<
            | {
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                signature?: string;
                text: string;
                type: "reasoning";
              }
            | { signature?: string; text: string; type: "text" }
            | { data: string; type: "redacted" }
          >;
          sources?: Array<
            | {
                id: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "url";
                title?: string;
                type?: "source";
                url: string;
              }
            | {
                filename?: string;
                id: string;
                mediaType: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "document";
                title: string;
                type: "source";
              }
          >;
          status?: "pending" | "success" | "failed";
          text?: string;
          usage?: {
            cachedInputTokens?: number;
            completionTokens: number;
            promptTokens: number;
            reasoningTokens?: number;
            totalTokens: number;
          };
          warnings?: Array<
            | { details?: string; setting: string; type: "unsupported-setting" }
            | { details?: string; tool: any; type: "unsupported-tool" }
            | { message: string; type: "other" }
          >;
        }>;
        pendingMessageId?: string;
        promptMessageId?: string;
        threadId: string;
        userId?: string;
      },
      {
        messages: Array<{
          _creationTime: number;
          _id: string;
          agentName?: string;
          embeddingId?: string;
          error?: string;
          fileIds?: Array<string>;
          finishReason?:
            | "stop"
            | "length"
            | "content-filter"
            | "tool-calls"
            | "error"
            | "other"
            | "unknown";
          id?: string;
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          signature?: string;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                      | {
                          args?: any;
                          experimental_content?: Array<
                            | { text: string; type: "text" }
                            | { data: string; mimeType?: string; type: "image" }
                          >;
                          isError?: boolean;
                          output?:
                            | { type: "text"; value: string }
                            | { type: "json"; value: any }
                            | { type: "error-text"; value: string }
                            | { type: "error-json"; value: any }
                            | {
                                type: "content";
                                value: Array<
                                  | { text: string; type: "text" }
                                  | {
                                      data: string;
                                      mediaType: string;
                                      type: "media";
                                    }
                                >;
                              };
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          result?: any;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-result";
                        }
                      | {
                          id: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "url";
                          title: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "document";
                          title: string;
                          type: "source";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "assistant";
              }
            | {
                content: Array<{
                  args?: any;
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  isError?: boolean;
                  output?:
                    | { type: "text"; value: string }
                    | { type: "json"; value: any }
                    | { type: "error-text"; value: string }
                    | { type: "error-json"; value: any }
                    | {
                        type: "content";
                        value: Array<
                          | { text: string; type: "text" }
                          | { data: string; mediaType: string; type: "media" }
                        >;
                      };
                  providerExecuted?: boolean;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  result?: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                providerOptions?: Record<string, Record<string, any>>;
                role: "tool";
              }
            | {
                content: string;
                providerOptions?: Record<string, Record<string, any>>;
                role: "system";
              };
          model?: string;
          order: number;
          provider?: string;
          providerMetadata?: Record<string, Record<string, any>>;
          providerOptions?: Record<string, Record<string, any>>;
          reasoning?: string;
          reasoningDetails?: Array<
            | {
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                signature?: string;
                text: string;
                type: "reasoning";
              }
            | { signature?: string; text: string; type: "text" }
            | { data: string; type: "redacted" }
          >;
          sources?: Array<
            | {
                id: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "url";
                title?: string;
                type?: "source";
                url: string;
              }
            | {
                filename?: string;
                id: string;
                mediaType: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "document";
                title: string;
                type: "source";
              }
          >;
          status: "pending" | "success" | "failed";
          stepOrder: number;
          text?: string;
          threadId: string;
          tool: boolean;
          usage?: {
            cachedInputTokens?: number;
            completionTokens: number;
            promptTokens: number;
            reasoningTokens?: number;
            totalTokens: number;
          };
          userId?: string;
          warnings?: Array<
            | { details?: string; setting: string; type: "unsupported-setting" }
            | { details?: string; tool: any; type: "unsupported-tool" }
            | { message: string; type: "other" }
          >;
        }>;
      }
    >;
    deleteByIds: FunctionReference<
      "mutation",
      "public",
      { messageIds: Array<string> },
      Array<string>
    >;
    deleteByOrder: FunctionReference<
      "mutation",
      "public",
      {
        endOrder: number;
        endStepOrder?: number;
        startOrder: number;
        startStepOrder?: number;
        threadId: string;
      },
      { isDone: boolean; lastOrder?: number; lastStepOrder?: number }
    >;
    finalizeMessage: FunctionReference<
      "mutation",
      "public",
      {
        messageId: string;
        result: { status: "success" } | { error: string; status: "failed" };
      },
      null
    >;
    getMessageSearchFields: FunctionReference<
      "query",
      "public",
      { messageId: string },
      { embedding?: Array<number>; embeddingModel?: string; text?: string }
    >;
    getMessagesByIds: FunctionReference<
      "query",
      "public",
      { messageIds: Array<string> },
      Array<null | {
        _creationTime: number;
        _id: string;
        agentName?: string;
        embeddingId?: string;
        error?: string;
        fileIds?: Array<string>;
        finishReason?:
          | "stop"
          | "length"
          | "content-filter"
          | "tool-calls"
          | "error"
          | "other"
          | "unknown";
        id?: string;
        message?:
          | {
              content:
                | string
                | Array<
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        text: string;
                        type: "text";
                      }
                    | {
                        image: string | ArrayBuffer;
                        mimeType?: string;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "image";
                      }
                    | {
                        data: string | ArrayBuffer;
                        filename?: string;
                        mimeType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "file";
                      }
                  >;
              providerOptions?: Record<string, Record<string, any>>;
              role: "user";
            }
          | {
              content:
                | string
                | Array<
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        text: string;
                        type: "text";
                      }
                    | {
                        data: string | ArrayBuffer;
                        filename?: string;
                        mimeType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "file";
                      }
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        signature?: string;
                        text: string;
                        type: "reasoning";
                      }
                    | {
                        data: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "redacted-reasoning";
                      }
                    | {
                        args: any;
                        providerExecuted?: boolean;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        toolCallId: string;
                        toolName: string;
                        type: "tool-call";
                      }
                    | {
                        args?: any;
                        experimental_content?: Array<
                          | { text: string; type: "text" }
                          | { data: string; mimeType?: string; type: "image" }
                        >;
                        isError?: boolean;
                        output?:
                          | { type: "text"; value: string }
                          | { type: "json"; value: any }
                          | { type: "error-text"; value: string }
                          | { type: "error-json"; value: any }
                          | {
                              type: "content";
                              value: Array<
                                | { text: string; type: "text" }
                                | {
                                    data: string;
                                    mediaType: string;
                                    type: "media";
                                  }
                              >;
                            };
                        providerExecuted?: boolean;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        result?: any;
                        toolCallId: string;
                        toolName: string;
                        type: "tool-result";
                      }
                    | {
                        id: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        sourceType: "url";
                        title: string;
                        type: "source";
                        url: string;
                      }
                    | {
                        filename?: string;
                        id: string;
                        mediaType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        sourceType: "document";
                        title: string;
                        type: "source";
                      }
                  >;
              providerOptions?: Record<string, Record<string, any>>;
              role: "assistant";
            }
          | {
              content: Array<{
                args?: any;
                experimental_content?: Array<
                  | { text: string; type: "text" }
                  | { data: string; mimeType?: string; type: "image" }
                >;
                isError?: boolean;
                output?:
                  | { type: "text"; value: string }
                  | { type: "json"; value: any }
                  | { type: "error-text"; value: string }
                  | { type: "error-json"; value: any }
                  | {
                      type: "content";
                      value: Array<
                        | { text: string; type: "text" }
                        | { data: string; mediaType: string; type: "media" }
                      >;
                    };
                providerExecuted?: boolean;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                result?: any;
                toolCallId: string;
                toolName: string;
                type: "tool-result";
              }>;
              providerOptions?: Record<string, Record<string, any>>;
              role: "tool";
            }
          | {
              content: string;
              providerOptions?: Record<string, Record<string, any>>;
              role: "system";
            };
        model?: string;
        order: number;
        provider?: string;
        providerMetadata?: Record<string, Record<string, any>>;
        providerOptions?: Record<string, Record<string, any>>;
        reasoning?: string;
        reasoningDetails?: Array<
          | {
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              signature?: string;
              text: string;
              type: "reasoning";
            }
          | { signature?: string; text: string; type: "text" }
          | { data: string; type: "redacted" }
        >;
        sources?: Array<
          | {
              id: string;
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              sourceType: "url";
              title?: string;
              type?: "source";
              url: string;
            }
          | {
              filename?: string;
              id: string;
              mediaType: string;
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              sourceType: "document";
              title: string;
              type: "source";
            }
        >;
        status: "pending" | "success" | "failed";
        stepOrder: number;
        text?: string;
        threadId: string;
        tool: boolean;
        usage?: {
          cachedInputTokens?: number;
          completionTokens: number;
          promptTokens: number;
          reasoningTokens?: number;
          totalTokens: number;
        };
        userId?: string;
        warnings?: Array<
          | { details?: string; setting: string; type: "unsupported-setting" }
          | { details?: string; tool: any; type: "unsupported-tool" }
          | { message: string; type: "other" }
        >;
      }>
    >;
    listMessagesByThreadId: FunctionReference<
      "query",
      "public",
      {
        excludeToolMessages?: boolean;
        order: "asc" | "desc";
        paginationOpts?: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        statuses?: Array<"pending" | "success" | "failed">;
        threadId: string;
        upToAndIncludingMessageId?: string;
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _creationTime: number;
          _id: string;
          agentName?: string;
          embeddingId?: string;
          error?: string;
          fileIds?: Array<string>;
          finishReason?:
            | "stop"
            | "length"
            | "content-filter"
            | "tool-calls"
            | "error"
            | "other"
            | "unknown";
          id?: string;
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          signature?: string;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                      | {
                          args?: any;
                          experimental_content?: Array<
                            | { text: string; type: "text" }
                            | { data: string; mimeType?: string; type: "image" }
                          >;
                          isError?: boolean;
                          output?:
                            | { type: "text"; value: string }
                            | { type: "json"; value: any }
                            | { type: "error-text"; value: string }
                            | { type: "error-json"; value: any }
                            | {
                                type: "content";
                                value: Array<
                                  | { text: string; type: "text" }
                                  | {
                                      data: string;
                                      mediaType: string;
                                      type: "media";
                                    }
                                >;
                              };
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          result?: any;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-result";
                        }
                      | {
                          id: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "url";
                          title: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "document";
                          title: string;
                          type: "source";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "assistant";
              }
            | {
                content: Array<{
                  args?: any;
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  isError?: boolean;
                  output?:
                    | { type: "text"; value: string }
                    | { type: "json"; value: any }
                    | { type: "error-text"; value: string }
                    | { type: "error-json"; value: any }
                    | {
                        type: "content";
                        value: Array<
                          | { text: string; type: "text" }
                          | { data: string; mediaType: string; type: "media" }
                        >;
                      };
                  providerExecuted?: boolean;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  result?: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                providerOptions?: Record<string, Record<string, any>>;
                role: "tool";
              }
            | {
                content: string;
                providerOptions?: Record<string, Record<string, any>>;
                role: "system";
              };
          model?: string;
          order: number;
          provider?: string;
          providerMetadata?: Record<string, Record<string, any>>;
          providerOptions?: Record<string, Record<string, any>>;
          reasoning?: string;
          reasoningDetails?: Array<
            | {
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                signature?: string;
                text: string;
                type: "reasoning";
              }
            | { signature?: string; text: string; type: "text" }
            | { data: string; type: "redacted" }
          >;
          sources?: Array<
            | {
                id: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "url";
                title?: string;
                type?: "source";
                url: string;
              }
            | {
                filename?: string;
                id: string;
                mediaType: string;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                sourceType: "document";
                title: string;
                type: "source";
              }
          >;
          status: "pending" | "success" | "failed";
          stepOrder: number;
          text?: string;
          threadId: string;
          tool: boolean;
          usage?: {
            cachedInputTokens?: number;
            completionTokens: number;
            promptTokens: number;
            reasoningTokens?: number;
            totalTokens: number;
          };
          userId?: string;
          warnings?: Array<
            | { details?: string; setting: string; type: "unsupported-setting" }
            | { details?: string; tool: any; type: "unsupported-tool" }
            | { message: string; type: "other" }
          >;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    searchMessages: FunctionReference<
      "action",
      "public",
      {
        embedding?: Array<number>;
        embeddingModel?: string;
        limit: number;
        messageRange?: { after: number; before: number };
        searchAllMessagesForUserId?: string;
        targetMessageId?: string;
        text?: string;
        textSearch?: boolean;
        threadId?: string;
        vectorScoreThreshold?: number;
        vectorSearch?: boolean;
      },
      Array<{
        _creationTime: number;
        _id: string;
        agentName?: string;
        embeddingId?: string;
        error?: string;
        fileIds?: Array<string>;
        finishReason?:
          | "stop"
          | "length"
          | "content-filter"
          | "tool-calls"
          | "error"
          | "other"
          | "unknown";
        id?: string;
        message?:
          | {
              content:
                | string
                | Array<
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        text: string;
                        type: "text";
                      }
                    | {
                        image: string | ArrayBuffer;
                        mimeType?: string;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "image";
                      }
                    | {
                        data: string | ArrayBuffer;
                        filename?: string;
                        mimeType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "file";
                      }
                  >;
              providerOptions?: Record<string, Record<string, any>>;
              role: "user";
            }
          | {
              content:
                | string
                | Array<
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        text: string;
                        type: "text";
                      }
                    | {
                        data: string | ArrayBuffer;
                        filename?: string;
                        mimeType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "file";
                      }
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        signature?: string;
                        text: string;
                        type: "reasoning";
                      }
                    | {
                        data: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "redacted-reasoning";
                      }
                    | {
                        args: any;
                        providerExecuted?: boolean;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        toolCallId: string;
                        toolName: string;
                        type: "tool-call";
                      }
                    | {
                        args?: any;
                        experimental_content?: Array<
                          | { text: string; type: "text" }
                          | { data: string; mimeType?: string; type: "image" }
                        >;
                        isError?: boolean;
                        output?:
                          | { type: "text"; value: string }
                          | { type: "json"; value: any }
                          | { type: "error-text"; value: string }
                          | { type: "error-json"; value: any }
                          | {
                              type: "content";
                              value: Array<
                                | { text: string; type: "text" }
                                | {
                                    data: string;
                                    mediaType: string;
                                    type: "media";
                                  }
                              >;
                            };
                        providerExecuted?: boolean;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        result?: any;
                        toolCallId: string;
                        toolName: string;
                        type: "tool-result";
                      }
                    | {
                        id: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        sourceType: "url";
                        title: string;
                        type: "source";
                        url: string;
                      }
                    | {
                        filename?: string;
                        id: string;
                        mediaType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        sourceType: "document";
                        title: string;
                        type: "source";
                      }
                  >;
              providerOptions?: Record<string, Record<string, any>>;
              role: "assistant";
            }
          | {
              content: Array<{
                args?: any;
                experimental_content?: Array<
                  | { text: string; type: "text" }
                  | { data: string; mimeType?: string; type: "image" }
                >;
                isError?: boolean;
                output?:
                  | { type: "text"; value: string }
                  | { type: "json"; value: any }
                  | { type: "error-text"; value: string }
                  | { type: "error-json"; value: any }
                  | {
                      type: "content";
                      value: Array<
                        | { text: string; type: "text" }
                        | { data: string; mediaType: string; type: "media" }
                      >;
                    };
                providerExecuted?: boolean;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                result?: any;
                toolCallId: string;
                toolName: string;
                type: "tool-result";
              }>;
              providerOptions?: Record<string, Record<string, any>>;
              role: "tool";
            }
          | {
              content: string;
              providerOptions?: Record<string, Record<string, any>>;
              role: "system";
            };
        model?: string;
        order: number;
        provider?: string;
        providerMetadata?: Record<string, Record<string, any>>;
        providerOptions?: Record<string, Record<string, any>>;
        reasoning?: string;
        reasoningDetails?: Array<
          | {
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              signature?: string;
              text: string;
              type: "reasoning";
            }
          | { signature?: string; text: string; type: "text" }
          | { data: string; type: "redacted" }
        >;
        sources?: Array<
          | {
              id: string;
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              sourceType: "url";
              title?: string;
              type?: "source";
              url: string;
            }
          | {
              filename?: string;
              id: string;
              mediaType: string;
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              sourceType: "document";
              title: string;
              type: "source";
            }
        >;
        status: "pending" | "success" | "failed";
        stepOrder: number;
        text?: string;
        threadId: string;
        tool: boolean;
        usage?: {
          cachedInputTokens?: number;
          completionTokens: number;
          promptTokens: number;
          reasoningTokens?: number;
          totalTokens: number;
        };
        userId?: string;
        warnings?: Array<
          | { details?: string; setting: string; type: "unsupported-setting" }
          | { details?: string; tool: any; type: "unsupported-tool" }
          | { message: string; type: "other" }
        >;
      }>
    >;
    textSearch: FunctionReference<
      "query",
      "public",
      {
        limit: number;
        searchAllMessagesForUserId?: string;
        targetMessageId?: string;
        text?: string;
        threadId?: string;
      },
      Array<{
        _creationTime: number;
        _id: string;
        agentName?: string;
        embeddingId?: string;
        error?: string;
        fileIds?: Array<string>;
        finishReason?:
          | "stop"
          | "length"
          | "content-filter"
          | "tool-calls"
          | "error"
          | "other"
          | "unknown";
        id?: string;
        message?:
          | {
              content:
                | string
                | Array<
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        text: string;
                        type: "text";
                      }
                    | {
                        image: string | ArrayBuffer;
                        mimeType?: string;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "image";
                      }
                    | {
                        data: string | ArrayBuffer;
                        filename?: string;
                        mimeType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "file";
                      }
                  >;
              providerOptions?: Record<string, Record<string, any>>;
              role: "user";
            }
          | {
              content:
                | string
                | Array<
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        text: string;
                        type: "text";
                      }
                    | {
                        data: string | ArrayBuffer;
                        filename?: string;
                        mimeType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "file";
                      }
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        signature?: string;
                        text: string;
                        type: "reasoning";
                      }
                    | {
                        data: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "redacted-reasoning";
                      }
                    | {
                        args: any;
                        providerExecuted?: boolean;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        toolCallId: string;
                        toolName: string;
                        type: "tool-call";
                      }
                    | {
                        args?: any;
                        experimental_content?: Array<
                          | { text: string; type: "text" }
                          | { data: string; mimeType?: string; type: "image" }
                        >;
                        isError?: boolean;
                        output?:
                          | { type: "text"; value: string }
                          | { type: "json"; value: any }
                          | { type: "error-text"; value: string }
                          | { type: "error-json"; value: any }
                          | {
                              type: "content";
                              value: Array<
                                | { text: string; type: "text" }
                                | {
                                    data: string;
                                    mediaType: string;
                                    type: "media";
                                  }
                              >;
                            };
                        providerExecuted?: boolean;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        result?: any;
                        toolCallId: string;
                        toolName: string;
                        type: "tool-result";
                      }
                    | {
                        id: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        sourceType: "url";
                        title: string;
                        type: "source";
                        url: string;
                      }
                    | {
                        filename?: string;
                        id: string;
                        mediaType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        sourceType: "document";
                        title: string;
                        type: "source";
                      }
                  >;
              providerOptions?: Record<string, Record<string, any>>;
              role: "assistant";
            }
          | {
              content: Array<{
                args?: any;
                experimental_content?: Array<
                  | { text: string; type: "text" }
                  | { data: string; mimeType?: string; type: "image" }
                >;
                isError?: boolean;
                output?:
                  | { type: "text"; value: string }
                  | { type: "json"; value: any }
                  | { type: "error-text"; value: string }
                  | { type: "error-json"; value: any }
                  | {
                      type: "content";
                      value: Array<
                        | { text: string; type: "text" }
                        | { data: string; mediaType: string; type: "media" }
                      >;
                    };
                providerExecuted?: boolean;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                result?: any;
                toolCallId: string;
                toolName: string;
                type: "tool-result";
              }>;
              providerOptions?: Record<string, Record<string, any>>;
              role: "tool";
            }
          | {
              content: string;
              providerOptions?: Record<string, Record<string, any>>;
              role: "system";
            };
        model?: string;
        order: number;
        provider?: string;
        providerMetadata?: Record<string, Record<string, any>>;
        providerOptions?: Record<string, Record<string, any>>;
        reasoning?: string;
        reasoningDetails?: Array<
          | {
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              signature?: string;
              text: string;
              type: "reasoning";
            }
          | { signature?: string; text: string; type: "text" }
          | { data: string; type: "redacted" }
        >;
        sources?: Array<
          | {
              id: string;
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              sourceType: "url";
              title?: string;
              type?: "source";
              url: string;
            }
          | {
              filename?: string;
              id: string;
              mediaType: string;
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              sourceType: "document";
              title: string;
              type: "source";
            }
        >;
        status: "pending" | "success" | "failed";
        stepOrder: number;
        text?: string;
        threadId: string;
        tool: boolean;
        usage?: {
          cachedInputTokens?: number;
          completionTokens: number;
          promptTokens: number;
          reasoningTokens?: number;
          totalTokens: number;
        };
        userId?: string;
        warnings?: Array<
          | { details?: string; setting: string; type: "unsupported-setting" }
          | { details?: string; tool: any; type: "unsupported-tool" }
          | { message: string; type: "other" }
        >;
      }>
    >;
    updateMessage: FunctionReference<
      "mutation",
      "public",
      {
        messageId: string;
        patch: {
          error?: string;
          fileIds?: Array<string>;
          finishReason?:
            | "stop"
            | "length"
            | "content-filter"
            | "tool-calls"
            | "error"
            | "other"
            | "unknown";
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          filename?: string;
                          mimeType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "file";
                        }
                      | {
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          signature?: string;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                      | {
                          args?: any;
                          experimental_content?: Array<
                            | { text: string; type: "text" }
                            | { data: string; mimeType?: string; type: "image" }
                          >;
                          isError?: boolean;
                          output?:
                            | { type: "text"; value: string }
                            | { type: "json"; value: any }
                            | { type: "error-text"; value: string }
                            | { type: "error-json"; value: any }
                            | {
                                type: "content";
                                value: Array<
                                  | { text: string; type: "text" }
                                  | {
                                      data: string;
                                      mediaType: string;
                                      type: "media";
                                    }
                                >;
                              };
                          providerExecuted?: boolean;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          result?: any;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-result";
                        }
                      | {
                          id: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "url";
                          title: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType: string;
                          providerMetadata?: Record<
                            string,
                            Record<string, any>
                          >;
                          providerOptions?: Record<string, Record<string, any>>;
                          sourceType: "document";
                          title: string;
                          type: "source";
                        }
                    >;
                providerOptions?: Record<string, Record<string, any>>;
                role: "assistant";
              }
            | {
                content: Array<{
                  args?: any;
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  isError?: boolean;
                  output?:
                    | { type: "text"; value: string }
                    | { type: "json"; value: any }
                    | { type: "error-text"; value: string }
                    | { type: "error-json"; value: any }
                    | {
                        type: "content";
                        value: Array<
                          | { text: string; type: "text" }
                          | { data: string; mediaType: string; type: "media" }
                        >;
                      };
                  providerExecuted?: boolean;
                  providerMetadata?: Record<string, Record<string, any>>;
                  providerOptions?: Record<string, Record<string, any>>;
                  result?: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                providerOptions?: Record<string, Record<string, any>>;
                role: "tool";
              }
            | {
                content: string;
                providerOptions?: Record<string, Record<string, any>>;
                role: "system";
              };
          model?: string;
          provider?: string;
          providerOptions?: Record<string, Record<string, any>>;
          status?: "pending" | "success" | "failed";
        };
      },
      {
        _creationTime: number;
        _id: string;
        agentName?: string;
        embeddingId?: string;
        error?: string;
        fileIds?: Array<string>;
        finishReason?:
          | "stop"
          | "length"
          | "content-filter"
          | "tool-calls"
          | "error"
          | "other"
          | "unknown";
        id?: string;
        message?:
          | {
              content:
                | string
                | Array<
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        text: string;
                        type: "text";
                      }
                    | {
                        image: string | ArrayBuffer;
                        mimeType?: string;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "image";
                      }
                    | {
                        data: string | ArrayBuffer;
                        filename?: string;
                        mimeType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "file";
                      }
                  >;
              providerOptions?: Record<string, Record<string, any>>;
              role: "user";
            }
          | {
              content:
                | string
                | Array<
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        text: string;
                        type: "text";
                      }
                    | {
                        data: string | ArrayBuffer;
                        filename?: string;
                        mimeType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "file";
                      }
                    | {
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        signature?: string;
                        text: string;
                        type: "reasoning";
                      }
                    | {
                        data: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        type: "redacted-reasoning";
                      }
                    | {
                        args: any;
                        providerExecuted?: boolean;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        toolCallId: string;
                        toolName: string;
                        type: "tool-call";
                      }
                    | {
                        args?: any;
                        experimental_content?: Array<
                          | { text: string; type: "text" }
                          | { data: string; mimeType?: string; type: "image" }
                        >;
                        isError?: boolean;
                        output?:
                          | { type: "text"; value: string }
                          | { type: "json"; value: any }
                          | { type: "error-text"; value: string }
                          | { type: "error-json"; value: any }
                          | {
                              type: "content";
                              value: Array<
                                | { text: string; type: "text" }
                                | {
                                    data: string;
                                    mediaType: string;
                                    type: "media";
                                  }
                              >;
                            };
                        providerExecuted?: boolean;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        result?: any;
                        toolCallId: string;
                        toolName: string;
                        type: "tool-result";
                      }
                    | {
                        id: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        sourceType: "url";
                        title: string;
                        type: "source";
                        url: string;
                      }
                    | {
                        filename?: string;
                        id: string;
                        mediaType: string;
                        providerMetadata?: Record<string, Record<string, any>>;
                        providerOptions?: Record<string, Record<string, any>>;
                        sourceType: "document";
                        title: string;
                        type: "source";
                      }
                  >;
              providerOptions?: Record<string, Record<string, any>>;
              role: "assistant";
            }
          | {
              content: Array<{
                args?: any;
                experimental_content?: Array<
                  | { text: string; type: "text" }
                  | { data: string; mimeType?: string; type: "image" }
                >;
                isError?: boolean;
                output?:
                  | { type: "text"; value: string }
                  | { type: "json"; value: any }
                  | { type: "error-text"; value: string }
                  | { type: "error-json"; value: any }
                  | {
                      type: "content";
                      value: Array<
                        | { text: string; type: "text" }
                        | { data: string; mediaType: string; type: "media" }
                      >;
                    };
                providerExecuted?: boolean;
                providerMetadata?: Record<string, Record<string, any>>;
                providerOptions?: Record<string, Record<string, any>>;
                result?: any;
                toolCallId: string;
                toolName: string;
                type: "tool-result";
              }>;
              providerOptions?: Record<string, Record<string, any>>;
              role: "tool";
            }
          | {
              content: string;
              providerOptions?: Record<string, Record<string, any>>;
              role: "system";
            };
        model?: string;
        order: number;
        provider?: string;
        providerMetadata?: Record<string, Record<string, any>>;
        providerOptions?: Record<string, Record<string, any>>;
        reasoning?: string;
        reasoningDetails?: Array<
          | {
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              signature?: string;
              text: string;
              type: "reasoning";
            }
          | { signature?: string; text: string; type: "text" }
          | { data: string; type: "redacted" }
        >;
        sources?: Array<
          | {
              id: string;
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              sourceType: "url";
              title?: string;
              type?: "source";
              url: string;
            }
          | {
              filename?: string;
              id: string;
              mediaType: string;
              providerMetadata?: Record<string, Record<string, any>>;
              providerOptions?: Record<string, Record<string, any>>;
              sourceType: "document";
              title: string;
              type: "source";
            }
        >;
        status: "pending" | "success" | "failed";
        stepOrder: number;
        text?: string;
        threadId: string;
        tool: boolean;
        usage?: {
          cachedInputTokens?: number;
          completionTokens: number;
          promptTokens: number;
          reasoningTokens?: number;
          totalTokens: number;
        };
        userId?: string;
        warnings?: Array<
          | { details?: string; setting: string; type: "unsupported-setting" }
          | { details?: string; tool: any; type: "unsupported-tool" }
          | { message: string; type: "other" }
        >;
      }
    >;
  };
  streams: {
    abort: FunctionReference<
      "mutation",
      "public",
      {
        finalDelta?: {
          end: number;
          parts: Array<any>;
          start: number;
          streamId: string;
        };
        reason: string;
        streamId: string;
      },
      boolean
    >;
    abortByOrder: FunctionReference<
      "mutation",
      "public",
      { order: number; reason: string; threadId: string },
      boolean
    >;
    addDelta: FunctionReference<
      "mutation",
      "public",
      { end: number; parts: Array<any>; start: number; streamId: string },
      boolean
    >;
    create: FunctionReference<
      "mutation",
      "public",
      {
        agentName?: string;
        format?: "UIMessageChunk" | "TextStreamPart";
        model?: string;
        order: number;
        provider?: string;
        providerOptions?: Record<string, Record<string, any>>;
        stepOrder: number;
        threadId: string;
        userId?: string;
      },
      string
    >;
    deleteAllStreamsForThreadIdAsync: FunctionReference<
      "mutation",
      "public",
      { deltaCursor?: string; streamOrder?: number; threadId: string },
      { deltaCursor?: string; isDone: boolean; streamOrder?: number }
    >;
    deleteAllStreamsForThreadIdSync: FunctionReference<
      "action",
      "public",
      { threadId: string },
      null
    >;
    deleteStreamAsync: FunctionReference<
      "mutation",
      "public",
      { cursor?: string; streamId: string },
      null
    >;
    deleteStreamSync: FunctionReference<
      "mutation",
      "public",
      { streamId: string },
      null
    >;
    finish: FunctionReference<
      "mutation",
      "public",
      {
        finalDelta?: {
          end: number;
          parts: Array<any>;
          start: number;
          streamId: string;
        };
        streamId: string;
      },
      null
    >;
    heartbeat: FunctionReference<
      "mutation",
      "public",
      { streamId: string },
      null
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        startOrder?: number;
        statuses?: Array<"streaming" | "finished" | "aborted">;
        threadId: string;
      },
      Array<{
        agentName?: string;
        format?: "UIMessageChunk" | "TextStreamPart";
        model?: string;
        order: number;
        provider?: string;
        providerOptions?: Record<string, Record<string, any>>;
        status: "streaming" | "finished" | "aborted";
        stepOrder: number;
        streamId: string;
        userId?: string;
      }>
    >;
    listDeltas: FunctionReference<
      "query",
      "public",
      {
        cursors: Array<{ cursor: number; streamId: string }>;
        threadId: string;
      },
      Array<{ end: number; parts: Array<any>; start: number; streamId: string }>
    >;
  };
  threads: {
    createThread: FunctionReference<
      "mutation",
      "public",
      {
        defaultSystemPrompt?: string;
        parentThreadIds?: Array<string>;
        summary?: string;
        title?: string;
        userId?: string;
      },
      {
        _creationTime: number;
        _id: string;
        status: "active" | "archived";
        summary?: string;
        title?: string;
        userId?: string;
      }
    >;
    deleteAllForThreadIdAsync: FunctionReference<
      "mutation",
      "public",
      {
        cursor?: string;
        deltaCursor?: string;
        limit?: number;
        messagesDone?: boolean;
        streamOrder?: number;
        streamsDone?: boolean;
        threadId: string;
      },
      { isDone: boolean }
    >;
    deleteAllForThreadIdSync: FunctionReference<
      "action",
      "public",
      { limit?: number; threadId: string },
      null
    >;
    getThread: FunctionReference<
      "query",
      "public",
      { threadId: string },
      {
        _creationTime: number;
        _id: string;
        status: "active" | "archived";
        summary?: string;
        title?: string;
        userId?: string;
      } | null
    >;
    listThreadsByUserId: FunctionReference<
      "query",
      "public",
      {
        order?: "asc" | "desc";
        paginationOpts?: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        userId?: string;
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _creationTime: number;
          _id: string;
          status: "active" | "archived";
          summary?: string;
          title?: string;
          userId?: string;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
    searchThreadTitles: FunctionReference<
      "query",
      "public",
      { limit: number; query: string; userId?: string | null },
      Array<{
        _creationTime: number;
        _id: string;
        status: "active" | "archived";
        summary?: string;
        title?: string;
        userId?: string;
      }>
    >;
    updateThread: FunctionReference<
      "mutation",
      "public",
      {
        patch: {
          status?: "active" | "archived";
          summary?: string;
          title?: string;
          userId?: string;
        };
        threadId: string;
      },
      {
        _creationTime: number;
        _id: string;
        status: "active" | "archived";
        summary?: string;
        title?: string;
        userId?: string;
      }
    >;
  };
  users: {
    deleteAllForUserId: FunctionReference<
      "action",
      "public",
      { userId: string },
      null
    >;
    deleteAllForUserIdAsync: FunctionReference<
      "mutation",
      "public",
      { userId: string },
      boolean
    >;
    listUsersWithThreads: FunctionReference<
      "query",
      "public",
      {
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<string>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      }
    >;
  };
  vector: {
    index: {
      deleteBatch: FunctionReference<
        "mutation",
        "public",
        {
          ids: Array<
            | string
            | string
            | string
            | string
            | string
            | string
            | string
            | string
            | string
            | string
          >;
        },
        null
      >;
      deleteBatchForThread: FunctionReference<
        "mutation",
        "public",
        {
          cursor?: string;
          limit: number;
          model: string;
          threadId: string;
          vectorDimension:
            | 128
            | 256
            | 512
            | 768
            | 1024
            | 1408
            | 1536
            | 2048
            | 3072
            | 4096;
        },
        { continueCursor: string; isDone: boolean }
      >;
      insertBatch: FunctionReference<
        "mutation",
        "public",
        {
          vectorDimension:
            | 128
            | 256
            | 512
            | 768
            | 1024
            | 1408
            | 1536
            | 2048
            | 3072
            | 4096;
          vectors: Array<{
            messageId?: string;
            model: string;
            table: string;
            threadId?: string;
            userId?: string;
            vector: Array<number>;
          }>;
        },
        Array<
          | string
          | string
          | string
          | string
          | string
          | string
          | string
          | string
          | string
          | string
        >
      >;
      paginate: FunctionReference<
        "query",
        "public",
        {
          cursor?: string;
          limit: number;
          table?: string;
          targetModel: string;
          vectorDimension:
            | 128
            | 256
            | 512
            | 768
            | 1024
            | 1408
            | 1536
            | 2048
            | 3072
            | 4096;
        },
        {
          continueCursor: string;
          ids: Array<
            | string
            | string
            | string
            | string
            | string
            | string
            | string
            | string
            | string
            | string
          >;
          isDone: boolean;
        }
      >;
      updateBatch: FunctionReference<
        "mutation",
        "public",
        {
          vectors: Array<{
            id:
              | string
              | string
              | string
              | string
              | string
              | string
              | string
              | string
              | string
              | string;
            model: string;
            vector: Array<number>;
          }>;
        },
        null
      >;
    };
  };
};
// For now fullApiWithMounts is only fullApi which provides
// jump-to-definition in component client code.
// Use Mounts for the same type without the inference.
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {};
