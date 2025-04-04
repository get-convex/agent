/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as lib from "../lib.js";
import type * as messages from "../messages.js";

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
  lib: typeof lib;
  messages: typeof messages;
}>;
export type Mounts = {
  messages: {
    addMessage: FunctionReference<
      "mutation",
      "public",
      {
        addPending?: boolean;
        chatId: string;
        clearPending?: boolean;
        fileId?: string;
        message?:
          | {
              content:
                | string
                | Array<
                    | {
                        experimental_providerMetadata?: Record<string, any>;
                        providerOptions?: Record<string, any>;
                        text: string;
                        type: "text";
                      }
                    | {
                        experimental_providerMetadata?: Record<string, any>;
                        image: string | ArrayBuffer;
                        mimeType?: string;
                        providerOptions?: Record<string, any>;
                        type: "image";
                      }
                    | {
                        data: string | ArrayBuffer;
                        experimental_providerMetadata?: Record<string, any>;
                        mimeType: string;
                        providerOptions?: Record<string, any>;
                        type: "file";
                      }
                  >;
              experimental_providerMetadata?: Record<string, any>;
              providerOptions?: Record<string, any>;
              role: "user";
            }
          | {
              content:
                | string
                | Array<
                    | {
                        experimental_providerMetadata?: Record<string, any>;
                        providerOptions?: Record<string, any>;
                        text: string;
                        type: "text";
                      }
                    | {
                        data: string | ArrayBuffer;
                        experimental_providerMetadata?: Record<string, any>;
                        mimeType: string;
                        providerOptions?: Record<string, any>;
                        type: "file";
                      }
                    | {
                        experimental_providerMetadata?: Record<string, any>;
                        providerOptions?: Record<string, any>;
                        text: string;
                        type: "reasoning";
                      }
                    | {
                        data: string;
                        experimental_providerMetadata?: Record<string, any>;
                        providerOptions?: Record<string, any>;
                        type: "redacted-reasoning";
                      }
                    | {
                        args: any;
                        experimental_providerMetadata?: Record<string, any>;
                        providerOptions?: Record<string, any>;
                        toolCallId: string;
                        toolName: string;
                        type: "tool-call";
                      }
                  >;
              experimental_providerMetadata?: Record<string, any>;
              providerOptions?: Record<string, any>;
              role: "assistant";
            }
          | {
              content: Array<{
                experimental_content?: Array<
                  | { text: string; type: "text" }
                  | { data: string; mimeType?: string; type: "image" }
                >;
                experimental_providerMetadata?: Record<string, any>;
                isError?: boolean;
                providerOptions?: Record<string, any>;
                result: any;
                toolCallId: string;
                toolName: string;
                type: "tool-result";
              }>;
              experimental_providerMetadata?: Record<string, any>;
              providerOptions?: Record<string, any>;
              role: "tool";
            }
          | {
              content: string;
              experimental_providerMetadata?: Record<string, any>;
              providerOptions?: Record<string, any>;
              role: "system";
            };
        visible?: boolean;
      },
      {
        message: {
          _creationTime: number;
          _id: string;
          chatId: string;
          fileId?: string;
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          text: string;
                          type: "text";
                        }
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, any>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          experimental_providerMetadata?: Record<string, any>;
                          mimeType: string;
                          providerOptions?: Record<string, any>;
                          type: "file";
                        }
                    >;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          experimental_providerMetadata?: Record<string, any>;
                          mimeType: string;
                          providerOptions?: Record<string, any>;
                          type: "file";
                        }
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                    >;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "assistant";
              }
            | {
                content: Array<{
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  experimental_providerMetadata?: Record<string, any>;
                  isError?: boolean;
                  providerOptions?: Record<string, any>;
                  result: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "tool";
              }
            | {
                content: string;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "system";
              };
          order: number;
          status: "pending" | "success" | "failed";
          visible: boolean;
          visibleOrder: number;
        };
        pending?: {
          _creationTime: number;
          _id: string;
          chatId: string;
          fileId?: string;
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          text: string;
                          type: "text";
                        }
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, any>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          experimental_providerMetadata?: Record<string, any>;
                          mimeType: string;
                          providerOptions?: Record<string, any>;
                          type: "file";
                        }
                    >;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          experimental_providerMetadata?: Record<string, any>;
                          mimeType: string;
                          providerOptions?: Record<string, any>;
                          type: "file";
                        }
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                    >;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "assistant";
              }
            | {
                content: Array<{
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  experimental_providerMetadata?: Record<string, any>;
                  isError?: boolean;
                  providerOptions?: Record<string, any>;
                  result: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "tool";
              }
            | {
                content: string;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "system";
              };
          order: number;
          status: "pending" | "success" | "failed";
          visible: boolean;
          visibleOrder: number;
        };
      }
    >;
    archiveChat: FunctionReference<
      "mutation",
      "public",
      { chatId: string },
      {
        _creationTime: number;
        _id: string;
        defaultSystemPrompt?: string;
        domainId?: string;
        order?: number;
        status: "active" | "archived";
        summary?: string;
        title?: string;
      }
    >;
    createChat: FunctionReference<
      "mutation",
      "public",
      {
        defaultSystemPrompt?: string;
        domainId?: string;
        summary?: string;
        title?: string;
      },
      {
        _creationTime: number;
        _id: string;
        defaultSystemPrompt?: string;
        domainId?: string;
        order?: number;
        status: "active" | "archived";
        summary?: string;
        title?: string;
      }
    >;
    deleteAllForDomainId: FunctionReference<
      "action",
      "public",
      { domainId: string },
      null
    >;
    deleteAllForDomainIdAsync: FunctionReference<
      "mutation",
      "public",
      { domainId: string },
      boolean
    >;
    getChat: FunctionReference<
      "query",
      "public",
      { chatId: string },
      {
        _creationTime: number;
        _id: string;
        defaultSystemPrompt?: string;
        domainId?: string;
        order?: number;
        status: "active" | "archived";
        summary?: string;
        title?: string;
      } | null
    >;
    getChatsByDomainId: FunctionReference<
      "query",
      "public",
      {
        cursor?: string | null;
        domainId: string;
        limit?: number;
        offset?: number;
        statuses?: Array<"active" | "archived">;
      },
      {
        chats: Array<{
          _creationTime: number;
          _id: string;
          defaultSystemPrompt?: string;
          domainId?: string;
          order?: number;
          status: "active" | "archived";
          summary?: string;
          title?: string;
        }>;
        continueCursor: string;
        isDone: boolean;
      }
    >;
    getFilesToDelete: FunctionReference<
      "query",
      "public",
      { cursor?: string; limit?: number },
      {
        continueCursor: string;
        files: Array<{
          _creationTime: number;
          _id: string;
          hash: string;
          refcount: number;
          storageId: string;
        }>;
        isDone: boolean;
      }
    >;
    getMessages: FunctionReference<
      "query",
      "public",
      {
        chatId: string;
        cursor?: string;
        limit?: number;
        offset?: number;
        order?: "asc" | "desc";
        statuses?: Array<"pending" | "success" | "failed">;
        visible?: boolean;
      },
      {
        continueCursor: string;
        isDone: boolean;
        messages: Array<{
          _creationTime: number;
          _id: string;
          chatId: string;
          fileId?: string;
          message?:
            | {
                content:
                  | string
                  | Array<
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          text: string;
                          type: "text";
                        }
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          image: string | ArrayBuffer;
                          mimeType?: string;
                          providerOptions?: Record<string, any>;
                          type: "image";
                        }
                      | {
                          data: string | ArrayBuffer;
                          experimental_providerMetadata?: Record<string, any>;
                          mimeType: string;
                          providerOptions?: Record<string, any>;
                          type: "file";
                        }
                    >;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "user";
              }
            | {
                content:
                  | string
                  | Array<
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          text: string;
                          type: "text";
                        }
                      | {
                          data: string | ArrayBuffer;
                          experimental_providerMetadata?: Record<string, any>;
                          mimeType: string;
                          providerOptions?: Record<string, any>;
                          type: "file";
                        }
                      | {
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          text: string;
                          type: "reasoning";
                        }
                      | {
                          data: string;
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          type: "redacted-reasoning";
                        }
                      | {
                          args: any;
                          experimental_providerMetadata?: Record<string, any>;
                          providerOptions?: Record<string, any>;
                          toolCallId: string;
                          toolName: string;
                          type: "tool-call";
                        }
                    >;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "assistant";
              }
            | {
                content: Array<{
                  experimental_content?: Array<
                    | { text: string; type: "text" }
                    | { data: string; mimeType?: string; type: "image" }
                  >;
                  experimental_providerMetadata?: Record<string, any>;
                  isError?: boolean;
                  providerOptions?: Record<string, any>;
                  result: any;
                  toolCallId: string;
                  toolName: string;
                  type: "tool-result";
                }>;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "tool";
              }
            | {
                content: string;
                experimental_providerMetadata?: Record<string, any>;
                providerOptions?: Record<string, any>;
                role: "system";
              };
          order: number;
          status: "pending" | "success" | "failed";
          visible: boolean;
          visibleOrder: number;
        }>;
      }
    >;
    updateChat: FunctionReference<
      "mutation",
      "public",
      {
        chatId: string;
        patch: {
          defaultSystemPrompt?: string;
          status?: "active" | "archived";
          summary?: string;
          title?: string;
        };
      },
      {
        _creationTime: number;
        _id: string;
        defaultSystemPrompt?: string;
        domainId?: string;
        order?: number;
        status: "active" | "archived";
        summary?: string;
        title?: string;
      }
    >;
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
