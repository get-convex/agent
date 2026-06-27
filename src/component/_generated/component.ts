/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    messages: {
      addMessages: FunctionReference<
        "mutation",
        "internal",
        {
          agentName?: string;
          failPendingSteps?: boolean;
          messages: Array<{
            clientKey?: string;
            error?: string;
            message: {
              author:
                | { type: "user"; userId?: string }
                | { name: string; type: "agent" }
                | { name: string; toolCallId: string; type: "tool" }
                | { type: "system" };
              content: Array<
                | { text: string; type: "text" }
                | { text: string; type: "reasoning" }
                | {
                    data?: string | ArrayBuffer;
                    fileId?: string;
                    filename?: string;
                    mediaType: string;
                    type: "file";
                    url?: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "url";
                    title?: string;
                    type: "source";
                    url: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "document";
                    title?: string;
                    type: "source";
                    url?: string;
                  }
                | {
                    input: any;
                    name: string;
                    toolCallId: string;
                    type: "tool-call";
                  }
                | {
                    error?: { code: string; message: string };
                    name?: string;
                    output?: any;
                    toolCallId: string;
                    type: "tool-result";
                  }
                | {
                    approvalId: string;
                    toolCallId: string;
                    type: "approval-request";
                  }
                | {
                    approvalId: string;
                    approved: boolean;
                    reason?: string;
                    toolCallId: string;
                    type: "approval-response";
                  }
              >;
            };
            status?: "pending" | "success" | "failed";
            text?: string;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              tokenDetails?: {
                input?: Record<string, number>;
                output?: Record<string, number>;
              };
              totalTokens?: number;
            };
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
            clientKey?: string;
            error?: string;
            message?: {
              author:
                | { type: "user"; userId?: string }
                | { name: string; type: "agent" }
                | { name: string; toolCallId: string; type: "tool" }
                | { type: "system" };
              content: Array<
                | { text: string; type: "text" }
                | { text: string; type: "reasoning" }
                | {
                    data?: string | ArrayBuffer;
                    fileId?: string;
                    filename?: string;
                    mediaType: string;
                    type: "file";
                    url?: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "url";
                    title?: string;
                    type: "source";
                    url: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "document";
                    title?: string;
                    type: "source";
                    url?: string;
                  }
                | {
                    input: any;
                    name: string;
                    toolCallId: string;
                    type: "tool-call";
                  }
                | {
                    error?: { code: string; message: string };
                    name?: string;
                    output?: any;
                    toolCallId: string;
                    type: "tool-result";
                  }
                | {
                    approvalId: string;
                    toolCallId: string;
                    type: "approval-request";
                  }
                | {
                    approvalId: string;
                    approved: boolean;
                    reason?: string;
                    toolCallId: string;
                    type: "approval-response";
                  }
              >;
            };
            order: number;
            status: "pending" | "success" | "failed";
            stepOrder: number;
            text?: string;
            threadId: string;
            tool: boolean;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              tokenDetails?: {
                input?: Record<string, number>;
                output?: Record<string, number>;
              };
              totalTokens?: number;
            };
            userId?: string;
          }>;
        },
        Name
      >;
      cloneThread: FunctionReference<
        "action",
        "internal",
        {
          batchSize?: number;
          excludeToolMessages?: boolean;
          insertAtOrder?: number;
          limit?: number;
          sourceThreadId: string;
          statuses?: Array<"pending" | "success" | "failed">;
          targetThreadId: string;
          upToAndIncludingMessageId?: string;
        },
        number,
        Name
      >;
      deleteByIds: FunctionReference<
        "mutation",
        "internal",
        { messageIds: Array<string> },
        Array<string>,
        Name
      >;
      deleteByOrder: FunctionReference<
        "mutation",
        "internal",
        {
          endOrder: number;
          endStepOrder?: number;
          startOrder: number;
          startStepOrder?: number;
          threadId: string;
        },
        { isDone: boolean; lastOrder?: number; lastStepOrder?: number },
        Name
      >;
      finalizeMessage: FunctionReference<
        "mutation",
        "internal",
        {
          messageId: string;
          result: { status: "success" } | { error: string; status: "failed" };
        },
        null,
        Name
      >;
      getMessagesByIds: FunctionReference<
        "query",
        "internal",
        { messageIds: Array<string> },
        Array<null | {
          _creationTime: number;
          _id: string;
          agentName?: string;
          clientKey?: string;
          error?: string;
          message?: {
            author:
              | { type: "user"; userId?: string }
              | { name: string; type: "agent" }
              | { name: string; toolCallId: string; type: "tool" }
              | { type: "system" };
            content: Array<
              | { text: string; type: "text" }
              | { text: string; type: "reasoning" }
              | {
                  data?: string | ArrayBuffer;
                  fileId?: string;
                  filename?: string;
                  mediaType: string;
                  type: "file";
                  url?: string;
                }
              | {
                  filename?: string;
                  id: string;
                  mediaType?: string;
                  sourceType: "url";
                  title?: string;
                  type: "source";
                  url: string;
                }
              | {
                  filename?: string;
                  id: string;
                  mediaType?: string;
                  sourceType: "document";
                  title?: string;
                  type: "source";
                  url?: string;
                }
              | {
                  input: any;
                  name: string;
                  toolCallId: string;
                  type: "tool-call";
                }
              | {
                  error?: { code: string; message: string };
                  name?: string;
                  output?: any;
                  toolCallId: string;
                  type: "tool-result";
                }
              | {
                  approvalId: string;
                  toolCallId: string;
                  type: "approval-request";
                }
              | {
                  approvalId: string;
                  approved: boolean;
                  reason?: string;
                  toolCallId: string;
                  type: "approval-response";
                }
            >;
          };
          order: number;
          status: "pending" | "success" | "failed";
          stepOrder: number;
          text?: string;
          threadId: string;
          tool: boolean;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
        }>,
        Name
      >;
      listMessagesByThreadId: FunctionReference<
        "query",
        "internal",
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
            clientKey?: string;
            error?: string;
            message?: {
              author:
                | { type: "user"; userId?: string }
                | { name: string; type: "agent" }
                | { name: string; toolCallId: string; type: "tool" }
                | { type: "system" };
              content: Array<
                | { text: string; type: "text" }
                | { text: string; type: "reasoning" }
                | {
                    data?: string | ArrayBuffer;
                    fileId?: string;
                    filename?: string;
                    mediaType: string;
                    type: "file";
                    url?: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "url";
                    title?: string;
                    type: "source";
                    url: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "document";
                    title?: string;
                    type: "source";
                    url?: string;
                  }
                | {
                    input: any;
                    name: string;
                    toolCallId: string;
                    type: "tool-call";
                  }
                | {
                    error?: { code: string; message: string };
                    name?: string;
                    output?: any;
                    toolCallId: string;
                    type: "tool-result";
                  }
                | {
                    approvalId: string;
                    toolCallId: string;
                    type: "approval-request";
                  }
                | {
                    approvalId: string;
                    approved: boolean;
                    reason?: string;
                    toolCallId: string;
                    type: "approval-response";
                  }
              >;
            };
            order: number;
            status: "pending" | "success" | "failed";
            stepOrder: number;
            text?: string;
            threadId: string;
            tool: boolean;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              tokenDetails?: {
                input?: Record<string, number>;
                output?: Record<string, number>;
              };
              totalTokens?: number;
            };
            userId?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      textSearch: FunctionReference<
        "query",
        "internal",
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
          clientKey?: string;
          error?: string;
          message?: {
            author:
              | { type: "user"; userId?: string }
              | { name: string; type: "agent" }
              | { name: string; toolCallId: string; type: "tool" }
              | { type: "system" };
            content: Array<
              | { text: string; type: "text" }
              | { text: string; type: "reasoning" }
              | {
                  data?: string | ArrayBuffer;
                  fileId?: string;
                  filename?: string;
                  mediaType: string;
                  type: "file";
                  url?: string;
                }
              | {
                  filename?: string;
                  id: string;
                  mediaType?: string;
                  sourceType: "url";
                  title?: string;
                  type: "source";
                  url: string;
                }
              | {
                  filename?: string;
                  id: string;
                  mediaType?: string;
                  sourceType: "document";
                  title?: string;
                  type: "source";
                  url?: string;
                }
              | {
                  input: any;
                  name: string;
                  toolCallId: string;
                  type: "tool-call";
                }
              | {
                  error?: { code: string; message: string };
                  name?: string;
                  output?: any;
                  toolCallId: string;
                  type: "tool-result";
                }
              | {
                  approvalId: string;
                  toolCallId: string;
                  type: "approval-request";
                }
              | {
                  approvalId: string;
                  approved: boolean;
                  reason?: string;
                  toolCallId: string;
                  type: "approval-response";
                }
            >;
          };
          order: number;
          status: "pending" | "success" | "failed";
          stepOrder: number;
          text?: string;
          threadId: string;
          tool: boolean;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
        }>,
        Name
      >;
      updateMessage: FunctionReference<
        "mutation",
        "internal",
        {
          messageId: string;
          patch: {
            error?: string;
            message?: {
              author:
                | { type: "user"; userId?: string }
                | { name: string; type: "agent" }
                | { name: string; toolCallId: string; type: "tool" }
                | { type: "system" };
              content: Array<
                | { text: string; type: "text" }
                | { text: string; type: "reasoning" }
                | {
                    data?: string | ArrayBuffer;
                    fileId?: string;
                    filename?: string;
                    mediaType: string;
                    type: "file";
                    url?: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "url";
                    title?: string;
                    type: "source";
                    url: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "document";
                    title?: string;
                    type: "source";
                    url?: string;
                  }
                | {
                    input: any;
                    name: string;
                    toolCallId: string;
                    type: "tool-call";
                  }
                | {
                    error?: { code: string; message: string };
                    name?: string;
                    output?: any;
                    toolCallId: string;
                    type: "tool-result";
                  }
                | {
                    approvalId: string;
                    toolCallId: string;
                    type: "approval-request";
                  }
                | {
                    approvalId: string;
                    approved: boolean;
                    reason?: string;
                    toolCallId: string;
                    type: "approval-response";
                  }
              >;
            };
            status?: "pending" | "success" | "failed";
          };
        },
        {
          _creationTime: number;
          _id: string;
          agentName?: string;
          clientKey?: string;
          error?: string;
          message?: {
            author:
              | { type: "user"; userId?: string }
              | { name: string; type: "agent" }
              | { name: string; toolCallId: string; type: "tool" }
              | { type: "system" };
            content: Array<
              | { text: string; type: "text" }
              | { text: string; type: "reasoning" }
              | {
                  data?: string | ArrayBuffer;
                  fileId?: string;
                  filename?: string;
                  mediaType: string;
                  type: "file";
                  url?: string;
                }
              | {
                  filename?: string;
                  id: string;
                  mediaType?: string;
                  sourceType: "url";
                  title?: string;
                  type: "source";
                  url: string;
                }
              | {
                  filename?: string;
                  id: string;
                  mediaType?: string;
                  sourceType: "document";
                  title?: string;
                  type: "source";
                  url?: string;
                }
              | {
                  input: any;
                  name: string;
                  toolCallId: string;
                  type: "tool-call";
                }
              | {
                  error?: { code: string; message: string };
                  name?: string;
                  output?: any;
                  toolCallId: string;
                  type: "tool-result";
                }
              | {
                  approvalId: string;
                  toolCallId: string;
                  type: "approval-request";
                }
              | {
                  approvalId: string;
                  approved: boolean;
                  reason?: string;
                  toolCallId: string;
                  type: "approval-response";
                }
            >;
          };
          order: number;
          status: "pending" | "success" | "failed";
          stepOrder: number;
          text?: string;
          threadId: string;
          tool: boolean;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
        },
        Name
      >;
    };
    runs: {
      appendEvents: FunctionReference<
        "mutation",
        "internal",
        {
          events: Array<
            | { text: string; type: "text.delta" }
            | { signature?: string; text: string; type: "reasoning.delta" }
            | {
                source:
                  | {
                      filename?: string;
                      id: string;
                      mediaType?: string;
                      sourceType: "url";
                      title?: string;
                      url: string;
                    }
                  | {
                      filename?: string;
                      id: string;
                      mediaType?: string;
                      sourceType: "document";
                      title?: string;
                      url?: string;
                    };
                type: "source";
              }
            | {
                file: {
                  data?: string | ArrayBuffer;
                  fileId?: string;
                  filename?: string;
                  mediaType: string;
                  url?: string;
                };
                type: "file";
              }
            | {
                input: any;
                name: string;
                toolCallId: string;
                type: "tool.call";
              }
            | {
                error?: { code: string; message: string };
                name?: string;
                output?: any;
                toolCallId: string;
                type: "tool.result";
              }
            | {
                approvalId: string;
                input: any;
                name: string;
                toolCallId: string;
                type: "approval.request";
              }
            | {
                approvalId: string;
                approved: boolean;
                reason?: string;
                toolCallId: string;
                type: "approval.response";
              }
            | { name: string; type: "data"; value: any }
            | { type: "output"; value: any }
            | {
                type: "usage";
                usage: {
                  inputTokens?: number;
                  outputTokens?: number;
                  tokenDetails?: {
                    input?: Record<string, number>;
                    output?: Record<string, number>;
                  };
                  totalTokens?: number;
                };
              }
            | {
                message: {
                  clientKey?: string;
                  error?: string;
                  message: {
                    author:
                      | { type: "user"; userId?: string }
                      | { name: string; type: "agent" }
                      | { name: string; toolCallId: string; type: "tool" }
                      | { type: "system" };
                    content: Array<
                      | { text: string; type: "text" }
                      | { text: string; type: "reasoning" }
                      | {
                          data?: string | ArrayBuffer;
                          fileId?: string;
                          filename?: string;
                          mediaType: string;
                          type: "file";
                          url?: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType?: string;
                          sourceType: "url";
                          title?: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType?: string;
                          sourceType: "document";
                          title?: string;
                          type: "source";
                          url?: string;
                        }
                      | {
                          input: any;
                          name: string;
                          toolCallId: string;
                          type: "tool-call";
                        }
                      | {
                          error?: { code: string; message: string };
                          name?: string;
                          output?: any;
                          toolCallId: string;
                          type: "tool-result";
                        }
                      | {
                          approvalId: string;
                          toolCallId: string;
                          type: "approval-request";
                        }
                      | {
                          approvalId: string;
                          approved: boolean;
                          reason?: string;
                          toolCallId: string;
                          type: "approval-response";
                        }
                    >;
                  };
                  status?: "pending" | "success" | "failed";
                  text?: string;
                  usage?: {
                    inputTokens?: number;
                    outputTokens?: number;
                    tokenDetails?: {
                      input?: Record<string, number>;
                      output?: Record<string, number>;
                    };
                    totalTokens?: number;
                  };
                };
                type: "message";
              }
            | { error: { code: string; message: string }; type: "error" }
            | {
                type: "done";
                usage?: {
                  inputTokens?: number;
                  outputTokens?: number;
                  tokenDetails?: {
                    input?: Record<string, number>;
                    output?: Record<string, number>;
                  };
                  totalTokens?: number;
                };
              }
          >;
          executionId: string;
          runId: string;
          startSequence: number;
        },
        | {
            nextEventSequence: number;
            run: {
              agentName: string;
              createdAt: number;
              error?: { code: string; message: string };
              finishedAt?: number;
              key?: string;
              messageId?: string;
              output?: any;
              resultMessageIds?: Array<string>;
              runId: string;
              startedAt?: number;
              status:
                | "pending"
                | "running"
                | "waiting"
                | "success"
                | "failed"
                | "canceled";
              streamId: string;
              threadId: string;
              updatedAt: number;
              usage?: {
                inputTokens?: number;
                outputTokens?: number;
                tokenDetails?: {
                  input?: Record<string, number>;
                  output?: Record<string, number>;
                };
                totalTokens?: number;
              };
              userId?: string;
              waiting?: { reason: "approval"; toolCallIds: Array<string> };
              workflowId?: string;
            };
            stopped: true;
          }
        | {
            eventCount: number;
            firstIndex: number;
            lastIndex: number;
            nextEventSequence: number;
            stopped: false;
          },
        Name
      >;
      beginExecution: FunctionReference<
        "mutation",
        "internal",
        { executionId: string; runId: string },
        {
          claimed: boolean;
          nextEventSequence: number;
          run: {
            agentName: string;
            createdAt: number;
            error?: { code: string; message: string };
            finishedAt?: number;
            key?: string;
            messageId?: string;
            output?: any;
            resultMessageIds?: Array<string>;
            runId: string;
            startedAt?: number;
            status:
              | "pending"
              | "running"
              | "waiting"
              | "success"
              | "failed"
              | "canceled";
            streamId: string;
            threadId: string;
            updatedAt: number;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              tokenDetails?: {
                input?: Record<string, number>;
                output?: Record<string, number>;
              };
              totalTokens?: number;
            };
            userId?: string;
            waiting?: { reason: "approval"; toolCallIds: Array<string> };
            workflowId?: string;
          };
        },
        Name
      >;
      cancel: FunctionReference<
        "mutation",
        "internal",
        { reason?: string; runId: string },
        {
          agentName: string;
          createdAt: number;
          error?: { code: string; message: string };
          finishedAt?: number;
          key?: string;
          messageId?: string;
          output?: any;
          resultMessageIds?: Array<string>;
          runId: string;
          startedAt?: number;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamId: string;
          threadId: string;
          updatedAt: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
          waiting?: { reason: "approval"; toolCallIds: Array<string> };
          workflowId?: string;
        },
        Name
      >;
      fail: FunctionReference<
        "mutation",
        "internal",
        {
          error: { code: string; message: string };
          executionId: string;
          runId: string;
        },
        {
          agentName: string;
          createdAt: number;
          error?: { code: string; message: string };
          finishedAt?: number;
          key?: string;
          messageId?: string;
          output?: any;
          resultMessageIds?: Array<string>;
          runId: string;
          startedAt?: number;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamId: string;
          threadId: string;
          updatedAt: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
          waiting?: { reason: "approval"; toolCallIds: Array<string> };
          workflowId?: string;
        },
        Name
      >;
      finish: FunctionReference<
        "mutation",
        "internal",
        {
          executionId: string;
          resultMessageIds?: Array<string>;
          runId: string;
        },
        {
          agentName: string;
          createdAt: number;
          error?: { code: string; message: string };
          finishedAt?: number;
          key?: string;
          messageId?: string;
          output?: any;
          resultMessageIds?: Array<string>;
          runId: string;
          startedAt?: number;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamId: string;
          threadId: string;
          updatedAt: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
          waiting?: { reason: "approval"; toolCallIds: Array<string> };
          workflowId?: string;
        },
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { runId: string },
        null | {
          agentName: string;
          createdAt: number;
          error?: { code: string; message: string };
          finishedAt?: number;
          key?: string;
          messageId?: string;
          output?: any;
          resultMessageIds?: Array<string>;
          runId: string;
          startedAt?: number;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamId: string;
          threadId: string;
          updatedAt: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
          waiting?: { reason: "approval"; toolCallIds: Array<string> };
          workflowId?: string;
        },
        Name
      >;
      link: FunctionReference<
        "mutation",
        "internal",
        { runId: string; workflowId: string },
        {
          agentName: string;
          createdAt: number;
          error?: { code: string; message: string };
          finishedAt?: number;
          key?: string;
          messageId?: string;
          output?: any;
          resultMessageIds?: Array<string>;
          runId: string;
          startedAt?: number;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamId: string;
          threadId: string;
          updatedAt: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
          waiting?: { reason: "approval"; toolCallIds: Array<string> };
          workflowId?: string;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          statuses?: Array<
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled"
          >;
          threadId: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            agentName: string;
            createdAt: number;
            error?: { code: string; message: string };
            finishedAt?: number;
            key?: string;
            messageId?: string;
            output?: any;
            resultMessageIds?: Array<string>;
            runId: string;
            startedAt?: number;
            status:
              | "pending"
              | "running"
              | "waiting"
              | "success"
              | "failed"
              | "canceled";
            streamId: string;
            threadId: string;
            updatedAt: number;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              tokenDetails?: {
                input?: Record<string, number>;
                output?: Record<string, number>;
              };
              totalTokens?: number;
            };
            userId?: string;
            waiting?: { reason: "approval"; toolCallIds: Array<string> };
            workflowId?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      listToolCalls: FunctionReference<
        "query",
        "internal",
        { runId: string },
        Array<{
          approvalId?: string;
          approved?: boolean;
          error?: { code: string; message: string };
          input: any;
          name: string;
          output?: any;
          reason?: string;
          requestedAt: number;
          resolvedAt?: number;
          runId: string;
          status: "pending" | "waiting" | "success" | "failed" | "canceled";
          toolCallId: string;
        }>,
        Name
      >;
      readEvents: FunctionReference<
        "query",
        "internal",
        {
          cursor?: string | null;
          numItems: number;
          runId: string;
          startIndex?: number;
        },
        {
          continueCursor: string;
          error?: { code: string; message: string };
          isDone: boolean;
          nextIndex: number;
          page: Array<{
            event:
              | { text: string; type: "text.delta" }
              | { signature?: string; text: string; type: "reasoning.delta" }
              | {
                  source:
                    | {
                        filename?: string;
                        id: string;
                        mediaType?: string;
                        sourceType: "url";
                        title?: string;
                        url: string;
                      }
                    | {
                        filename?: string;
                        id: string;
                        mediaType?: string;
                        sourceType: "document";
                        title?: string;
                        url?: string;
                      };
                  type: "source";
                }
              | {
                  file: {
                    data?: string | ArrayBuffer;
                    fileId?: string;
                    filename?: string;
                    mediaType: string;
                    url?: string;
                  };
                  type: "file";
                }
              | {
                  input: any;
                  name: string;
                  toolCallId: string;
                  type: "tool.call";
                }
              | {
                  error?: { code: string; message: string };
                  name?: string;
                  output?: any;
                  toolCallId: string;
                  type: "tool.result";
                }
              | {
                  approvalId: string;
                  input: any;
                  name: string;
                  toolCallId: string;
                  type: "approval.request";
                }
              | {
                  approvalId: string;
                  approved: boolean;
                  reason?: string;
                  toolCallId: string;
                  type: "approval.response";
                }
              | { name: string; type: "data"; value: any }
              | { type: "output"; value: any }
              | {
                  type: "usage";
                  usage: {
                    inputTokens?: number;
                    outputTokens?: number;
                    tokenDetails?: {
                      input?: Record<string, number>;
                      output?: Record<string, number>;
                    };
                    totalTokens?: number;
                  };
                }
              | {
                  message: {
                    clientKey?: string;
                    error?: string;
                    message: {
                      author:
                        | { type: "user"; userId?: string }
                        | { name: string; type: "agent" }
                        | { name: string; toolCallId: string; type: "tool" }
                        | { type: "system" };
                      content: Array<
                        | { text: string; type: "text" }
                        | { text: string; type: "reasoning" }
                        | {
                            data?: string | ArrayBuffer;
                            fileId?: string;
                            filename?: string;
                            mediaType: string;
                            type: "file";
                            url?: string;
                          }
                        | {
                            filename?: string;
                            id: string;
                            mediaType?: string;
                            sourceType: "url";
                            title?: string;
                            type: "source";
                            url: string;
                          }
                        | {
                            filename?: string;
                            id: string;
                            mediaType?: string;
                            sourceType: "document";
                            title?: string;
                            type: "source";
                            url?: string;
                          }
                        | {
                            input: any;
                            name: string;
                            toolCallId: string;
                            type: "tool-call";
                          }
                        | {
                            error?: { code: string; message: string };
                            name?: string;
                            output?: any;
                            toolCallId: string;
                            type: "tool-result";
                          }
                        | {
                            approvalId: string;
                            toolCallId: string;
                            type: "approval-request";
                          }
                        | {
                            approvalId: string;
                            approved: boolean;
                            reason?: string;
                            toolCallId: string;
                            type: "approval-response";
                          }
                      >;
                    };
                    status?: "pending" | "success" | "failed";
                    text?: string;
                    usage?: {
                      inputTokens?: number;
                      outputTokens?: number;
                      tokenDetails?: {
                        input?: Record<string, number>;
                        output?: Record<string, number>;
                      };
                      totalTokens?: number;
                    };
                  };
                  type: "message";
                }
              | { error: { code: string; message: string }; type: "error" }
              | {
                  type: "done";
                  usage?: {
                    inputTokens?: number;
                    outputTokens?: number;
                    tokenDetails?: {
                      input?: Record<string, number>;
                      output?: Record<string, number>;
                    };
                    totalTokens?: number;
                  };
                };
            index: number;
            sequence: number;
          }>;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamStatus:
            | "pending"
            | "running"
            | "success"
            | "failed"
            | "canceled";
          upToDate: boolean;
        },
        Name
      >;
      readEventsBatch: FunctionReference<
        "query",
        "internal",
        {
          reads: Array<{
            runId: string;
            streamArgs: {
              cursor?: string | null;
              numItems: number;
              startIndex?: number;
            };
          }>;
        },
        Array<{
          continueCursor: string;
          error?: { code: string; message: string };
          isDone: boolean;
          nextIndex: number;
          page: Array<{
            event:
              | { text: string; type: "text.delta" }
              | { signature?: string; text: string; type: "reasoning.delta" }
              | {
                  source:
                    | {
                        filename?: string;
                        id: string;
                        mediaType?: string;
                        sourceType: "url";
                        title?: string;
                        url: string;
                      }
                    | {
                        filename?: string;
                        id: string;
                        mediaType?: string;
                        sourceType: "document";
                        title?: string;
                        url?: string;
                      };
                  type: "source";
                }
              | {
                  file: {
                    data?: string | ArrayBuffer;
                    fileId?: string;
                    filename?: string;
                    mediaType: string;
                    url?: string;
                  };
                  type: "file";
                }
              | {
                  input: any;
                  name: string;
                  toolCallId: string;
                  type: "tool.call";
                }
              | {
                  error?: { code: string; message: string };
                  name?: string;
                  output?: any;
                  toolCallId: string;
                  type: "tool.result";
                }
              | {
                  approvalId: string;
                  input: any;
                  name: string;
                  toolCallId: string;
                  type: "approval.request";
                }
              | {
                  approvalId: string;
                  approved: boolean;
                  reason?: string;
                  toolCallId: string;
                  type: "approval.response";
                }
              | { name: string; type: "data"; value: any }
              | { type: "output"; value: any }
              | {
                  type: "usage";
                  usage: {
                    inputTokens?: number;
                    outputTokens?: number;
                    tokenDetails?: {
                      input?: Record<string, number>;
                      output?: Record<string, number>;
                    };
                    totalTokens?: number;
                  };
                }
              | {
                  message: {
                    clientKey?: string;
                    error?: string;
                    message: {
                      author:
                        | { type: "user"; userId?: string }
                        | { name: string; type: "agent" }
                        | { name: string; toolCallId: string; type: "tool" }
                        | { type: "system" };
                      content: Array<
                        | { text: string; type: "text" }
                        | { text: string; type: "reasoning" }
                        | {
                            data?: string | ArrayBuffer;
                            fileId?: string;
                            filename?: string;
                            mediaType: string;
                            type: "file";
                            url?: string;
                          }
                        | {
                            filename?: string;
                            id: string;
                            mediaType?: string;
                            sourceType: "url";
                            title?: string;
                            type: "source";
                            url: string;
                          }
                        | {
                            filename?: string;
                            id: string;
                            mediaType?: string;
                            sourceType: "document";
                            title?: string;
                            type: "source";
                            url?: string;
                          }
                        | {
                            input: any;
                            name: string;
                            toolCallId: string;
                            type: "tool-call";
                          }
                        | {
                            error?: { code: string; message: string };
                            name?: string;
                            output?: any;
                            toolCallId: string;
                            type: "tool-result";
                          }
                        | {
                            approvalId: string;
                            toolCallId: string;
                            type: "approval-request";
                          }
                        | {
                            approvalId: string;
                            approved: boolean;
                            reason?: string;
                            toolCallId: string;
                            type: "approval-response";
                          }
                      >;
                    };
                    status?: "pending" | "success" | "failed";
                    text?: string;
                    usage?: {
                      inputTokens?: number;
                      outputTokens?: number;
                      tokenDetails?: {
                        input?: Record<string, number>;
                        output?: Record<string, number>;
                      };
                      totalTokens?: number;
                    };
                  };
                  type: "message";
                }
              | { error: { code: string; message: string }; type: "error" }
              | {
                  type: "done";
                  usage?: {
                    inputTokens?: number;
                    outputTokens?: number;
                    tokenDetails?: {
                      input?: Record<string, number>;
                      output?: Record<string, number>;
                    };
                    totalTokens?: number;
                  };
                };
            index: number;
            sequence: number;
          }>;
          runId: string;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamStatus:
            | "pending"
            | "running"
            | "success"
            | "failed"
            | "canceled";
          upToDate: boolean;
        }>,
        Name
      >;
      requestApproval: FunctionReference<
        "mutation",
        "internal",
        {
          events: Array<
            | { text: string; type: "text.delta" }
            | { signature?: string; text: string; type: "reasoning.delta" }
            | {
                source:
                  | {
                      filename?: string;
                      id: string;
                      mediaType?: string;
                      sourceType: "url";
                      title?: string;
                      url: string;
                    }
                  | {
                      filename?: string;
                      id: string;
                      mediaType?: string;
                      sourceType: "document";
                      title?: string;
                      url?: string;
                    };
                type: "source";
              }
            | {
                file: {
                  data?: string | ArrayBuffer;
                  fileId?: string;
                  filename?: string;
                  mediaType: string;
                  url?: string;
                };
                type: "file";
              }
            | {
                input: any;
                name: string;
                toolCallId: string;
                type: "tool.call";
              }
            | {
                error?: { code: string; message: string };
                name?: string;
                output?: any;
                toolCallId: string;
                type: "tool.result";
              }
            | {
                approvalId: string;
                input: any;
                name: string;
                toolCallId: string;
                type: "approval.request";
              }
            | {
                approvalId: string;
                approved: boolean;
                reason?: string;
                toolCallId: string;
                type: "approval.response";
              }
            | { name: string; type: "data"; value: any }
            | { type: "output"; value: any }
            | {
                type: "usage";
                usage: {
                  inputTokens?: number;
                  outputTokens?: number;
                  tokenDetails?: {
                    input?: Record<string, number>;
                    output?: Record<string, number>;
                  };
                  totalTokens?: number;
                };
              }
            | {
                message: {
                  clientKey?: string;
                  error?: string;
                  message: {
                    author:
                      | { type: "user"; userId?: string }
                      | { name: string; type: "agent" }
                      | { name: string; toolCallId: string; type: "tool" }
                      | { type: "system" };
                    content: Array<
                      | { text: string; type: "text" }
                      | { text: string; type: "reasoning" }
                      | {
                          data?: string | ArrayBuffer;
                          fileId?: string;
                          filename?: string;
                          mediaType: string;
                          type: "file";
                          url?: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType?: string;
                          sourceType: "url";
                          title?: string;
                          type: "source";
                          url: string;
                        }
                      | {
                          filename?: string;
                          id: string;
                          mediaType?: string;
                          sourceType: "document";
                          title?: string;
                          type: "source";
                          url?: string;
                        }
                      | {
                          input: any;
                          name: string;
                          toolCallId: string;
                          type: "tool-call";
                        }
                      | {
                          error?: { code: string; message: string };
                          name?: string;
                          output?: any;
                          toolCallId: string;
                          type: "tool-result";
                        }
                      | {
                          approvalId: string;
                          toolCallId: string;
                          type: "approval-request";
                        }
                      | {
                          approvalId: string;
                          approved: boolean;
                          reason?: string;
                          toolCallId: string;
                          type: "approval-response";
                        }
                    >;
                  };
                  status?: "pending" | "success" | "failed";
                  text?: string;
                  usage?: {
                    inputTokens?: number;
                    outputTokens?: number;
                    tokenDetails?: {
                      input?: Record<string, number>;
                      output?: Record<string, number>;
                    };
                    totalTokens?: number;
                  };
                };
                type: "message";
              }
            | { error: { code: string; message: string }; type: "error" }
            | {
                type: "done";
                usage?: {
                  inputTokens?: number;
                  outputTokens?: number;
                  tokenDetails?: {
                    input?: Record<string, number>;
                    output?: Record<string, number>;
                  };
                  totalTokens?: number;
                };
              }
          >;
          executionId: string;
          runId: string;
          startSequence: number;
          toolCallIds: Array<string>;
        },
        {
          agentName: string;
          createdAt: number;
          error?: { code: string; message: string };
          finishedAt?: number;
          key?: string;
          messageId?: string;
          output?: any;
          resultMessageIds?: Array<string>;
          runId: string;
          startedAt?: number;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamId: string;
          threadId: string;
          updatedAt: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
          waiting?: { reason: "approval"; toolCallIds: Array<string> };
          workflowId?: string;
        },
        Name
      >;
      resolveApproval: FunctionReference<
        "mutation",
        "internal",
        {
          approved: boolean;
          reason?: string;
          runId: string;
          toolCallId: string;
        },
        {
          agentName: string;
          createdAt: number;
          error?: { code: string; message: string };
          finishedAt?: number;
          key?: string;
          messageId?: string;
          output?: any;
          resultMessageIds?: Array<string>;
          runId: string;
          startedAt?: number;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamId: string;
          threadId: string;
          updatedAt: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
          waiting?: { reason: "approval"; toolCallIds: Array<string> };
          workflowId?: string;
        },
        Name
      >;
      saveResultMessages: FunctionReference<
        "mutation",
        "internal",
        {
          executionId: string;
          messages: Array<{
            clientKey?: string;
            error?: string;
            message: {
              author:
                | { type: "user"; userId?: string }
                | { name: string; type: "agent" }
                | { name: string; toolCallId: string; type: "tool" }
                | { type: "system" };
              content: Array<
                | { text: string; type: "text" }
                | { text: string; type: "reasoning" }
                | {
                    data?: string | ArrayBuffer;
                    fileId?: string;
                    filename?: string;
                    mediaType: string;
                    type: "file";
                    url?: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "url";
                    title?: string;
                    type: "source";
                    url: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "document";
                    title?: string;
                    type: "source";
                    url?: string;
                  }
                | {
                    input: any;
                    name: string;
                    toolCallId: string;
                    type: "tool-call";
                  }
                | {
                    error?: { code: string; message: string };
                    name?: string;
                    output?: any;
                    toolCallId: string;
                    type: "tool-result";
                  }
                | {
                    approvalId: string;
                    toolCallId: string;
                    type: "approval-request";
                  }
                | {
                    approvalId: string;
                    approved: boolean;
                    reason?: string;
                    toolCallId: string;
                    type: "approval-response";
                  }
              >;
            };
            status?: "pending" | "success" | "failed";
            text?: string;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              tokenDetails?: {
                input?: Record<string, number>;
                output?: Record<string, number>;
              };
              totalTokens?: number;
            };
          }>;
          runId: string;
        },
        {
          agentName: string;
          createdAt: number;
          error?: { code: string; message: string };
          finishedAt?: number;
          key?: string;
          messageId?: string;
          output?: any;
          resultMessageIds?: Array<string>;
          runId: string;
          startedAt?: number;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamId: string;
          threadId: string;
          updatedAt: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
          waiting?: { reason: "approval"; toolCallIds: Array<string> };
          workflowId?: string;
        },
        Name
      >;
      start: FunctionReference<
        "mutation",
        "internal",
        {
          agentName: string;
          key?: string;
          message?: {
            clientKey?: string;
            error?: string;
            message: {
              author:
                | { type: "user"; userId?: string }
                | { name: string; type: "agent" }
                | { name: string; toolCallId: string; type: "tool" }
                | { type: "system" };
              content: Array<
                | { text: string; type: "text" }
                | { text: string; type: "reasoning" }
                | {
                    data?: string | ArrayBuffer;
                    fileId?: string;
                    filename?: string;
                    mediaType: string;
                    type: "file";
                    url?: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "url";
                    title?: string;
                    type: "source";
                    url: string;
                  }
                | {
                    filename?: string;
                    id: string;
                    mediaType?: string;
                    sourceType: "document";
                    title?: string;
                    type: "source";
                    url?: string;
                  }
                | {
                    input: any;
                    name: string;
                    toolCallId: string;
                    type: "tool-call";
                  }
                | {
                    error?: { code: string; message: string };
                    name?: string;
                    output?: any;
                    toolCallId: string;
                    type: "tool-result";
                  }
                | {
                    approvalId: string;
                    toolCallId: string;
                    type: "approval-request";
                  }
                | {
                    approvalId: string;
                    approved: boolean;
                    reason?: string;
                    toolCallId: string;
                    type: "approval-response";
                  }
              >;
            };
            status?: "pending" | "success" | "failed";
            text?: string;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              tokenDetails?: {
                input?: Record<string, number>;
                output?: Record<string, number>;
              };
              totalTokens?: number;
            };
          };
          prompt?: string;
          threadId: string;
          userId?: string;
        },
        {
          agentName: string;
          createdAt: number;
          error?: { code: string; message: string };
          finishedAt?: number;
          key?: string;
          messageId?: string;
          output?: any;
          resultMessageIds?: Array<string>;
          runId: string;
          startedAt?: number;
          status:
            | "pending"
            | "running"
            | "waiting"
            | "success"
            | "failed"
            | "canceled";
          streamId: string;
          threadId: string;
          updatedAt: number;
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            tokenDetails?: {
              input?: Record<string, number>;
              output?: Record<string, number>;
            };
            totalTokens?: number;
          };
          userId?: string;
          waiting?: { reason: "approval"; toolCallIds: Array<string> };
          workflowId?: string;
        },
        Name
      >;
    };
    threads: {
      createThread: FunctionReference<
        "mutation",
        "internal",
        { summary?: string; title?: string; userId?: string },
        {
          _creationTime: number;
          _id: string;
          status: "active" | "archived";
          summary?: string;
          title?: string;
          userId?: string;
        },
        Name
      >;
      deleteAllForThreadIdAsync: FunctionReference<
        "mutation",
        "internal",
        {
          cursor?: string;
          limit?: number;
          messagesDone?: boolean;
          runCursor?: string;
          runsDone?: boolean;
          threadId: string;
        },
        { isDone: boolean },
        Name
      >;
      deleteAllForThreadIdSync: FunctionReference<
        "action",
        "internal",
        { limit?: number; threadId: string },
        null,
        Name
      >;
      getThread: FunctionReference<
        "query",
        "internal",
        { threadId: string },
        {
          _creationTime: number;
          _id: string;
          status: "active" | "archived";
          summary?: string;
          title?: string;
          userId?: string;
        } | null,
        Name
      >;
      listThreadsByUserId: FunctionReference<
        "query",
        "internal",
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
        },
        Name
      >;
      searchThreadTitles: FunctionReference<
        "query",
        "internal",
        { limit: number; query: string; userId?: string | null },
        Array<{
          _creationTime: number;
          _id: string;
          status: "active" | "archived";
          summary?: string;
          title?: string;
          userId?: string;
        }>,
        Name
      >;
      updateThread: FunctionReference<
        "mutation",
        "internal",
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
        },
        Name
      >;
    };
    users: {
      deleteAllForUserId: FunctionReference<
        "action",
        "internal",
        { userId: string },
        null,
        Name
      >;
      deleteAllForUserIdAsync: FunctionReference<
        "mutation",
        "internal",
        { userId: string },
        boolean,
        Name
      >;
      listUsersWithThreads: FunctionReference<
        "query",
        "internal",
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
        },
        Name
      >;
    };
  };
