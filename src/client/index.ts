/**
 * Convex-native agents with durable runs, messages, tools, approvals, usage,
 * output, and run-owned event logs.
 *
 * @packageDocumentation
 */

import type {
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import type { Infer, Validator, Value } from "convex/values";
import { v } from "convex/values";
import {
  serveHttpStream,
  type StreamQueryArgs,
} from "@convex-dev/stream";
import {
  vAgentError,
  vAgentMessage,
  vAgentMessageDoc,
  vAgentMessageInput,
  vAgentRunEvent,
  vAgentStatus,
  vAgentUsage,
  vThreadStatus,
  vThreadDoc,
  type AgentMessage,
  type AgentMessageContent,
  type AgentMessageDoc,
  type AgentMessageInput,
  type AgentMessagePart,
  type AgentError,
  type AgentRunEvent,
  type AgentStatus,
  type AgentToolCall,
  type AgentUsage,
  type ThreadDoc,
} from "../validators.js";
import type { AgentRunEventRead } from "./runEvents.js";
import { AgentRunExecution } from "./execution.js";
import { normalizeMessage } from "./messageInput.js";
import {
  maybeComponentMessageId,
  toComponentRunId,
  toComponentThreadId,
  type AgentComponent,
  type AgentExecutionCtx,
  type AgentHttpCtx,
  type AgentMutationCtx,
  type AgentQueryCtx,
} from "./componentRefs.js";

export type { AgentComponent } from "./componentRefs.js";

/**
 * Durable run metadata returned by the Agent core APIs.
 *
 * @remarks
 * A run is the durable intent to advance a thread. Every run owns an internal
 * event stream. The `streamId` is returned for correlation headers and
 * diagnostics; application code should authorize by run id and use Agent APIs
 * instead of writing to the underlying Stream directly.
 *
 * @public
 */
export type AgentRun = {
  runId: string;
  threadId: string;
  userId?: string;
  agentName: string;
  messageId?: string;
  resultMessageIds?: string[];
  streamId: string;
  workflowId?: string;
  key?: string;
  status: AgentStatus;
  waiting?: {
    reason: "approval";
    toolCallIds: string[];
  };
  error?: AgentError;
  usage?: AgentUsage;
  output?: Value;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
};

/**
 * Agent-native tool definition.
 *
 * @typeParam Input - Convex value accepted by the tool. Supplying `input`
 * validates model-provided input before approval or execution.
 *
 * @public
 */
export type AgentTool<Input extends Value = Value> = {
  description?: string;
  input?: Validator<Input, "required", string>;
  needsApproval?:
    | boolean
    | ((input: Input, context: AgentToolContext) => boolean | Promise<boolean>);
  execute: (input: Input, context: AgentToolContext) => Promise<Value>;
};

/**
 * A tool registry. Elements are stored input-erased (`AgentTool<Value>`):
 * `AgentTool` is invariant in its input, so a heterogeneous collection of
 * precisely typed tools shares no concrete element type. `defineTool` validates
 * input to its precise shape before `execute` runs, so the erasure is sound.
 *
 * @public
 */
export type AnyAgentTools = Record<string, AgentTool>;

/**
 * Context passed to Agent-native tool executions and approval predicates.
 *
 * @public
 */
export type AgentToolContext = {
  ctx: AgentExecutionCtx;
  run: AgentRun;
  runId: string;
  threadId: string;
  userId?: string;
  toolCallId: string;
  name: string;
  signal?: AbortSignal;
};

/**
 * App-provided context passed to the model before execution.
 *
 * @remarks
 * Retrieval systems such as `@convex-dev/rag` should return context blocks
 * through loaders instead of storing retrieval state in Agent core.
 *
 * @public
 */
export type AgentContextBlock = {
  type: "text";
  name?: string;
  text: string;
  metadata?: Value;
};

/**
 * Loads app-owned context for a run.
 *
 * @public
 */
export type AgentContextLoader = (
  ctx: AgentExecutionCtx,
  args: {
    run: AgentRun;
    promptMessage?: AgentMessageDoc;
    recentMessages: AgentMessageDoc[];
  },
) => Promise<AgentContextBlock[]>;

/**
 * Model-agnostic request passed to an Agent model implementation.
 *
 * @remarks
 * This is the producer boundary for Agent-owned events. The model yields
 * `AgentRunEvent` values; Agent persists them to the run stream and materializes
 * messages/tool state.
 *
 * @public
 */
export type AgentModelRequest<Tools extends AnyAgentTools = AnyAgentTools> = {
  run: AgentRun;
  messages: AgentMessageDoc[];
  context: AgentContextBlock[];
  tools?: Tools;
  signal?: AbortSignal;
};

/**
 * Model-agnostic interface for Agent core execution.
 *
 * @public
 */
export type AgentModel<Tools extends AnyAgentTools = AnyAgentTools> = {
  execute(request: AgentModelRequest<Tools>): AsyncIterable<AgentRunEvent>;
};

/**
 * Configuration for an Agent instance.
 *
 * @public
 */
export type AgentOptions<Tools extends AnyAgentTools = AnyAgentTools> = {
  name: string;
  model?: AgentModel<Tools>;
  tools?: Tools;
  output?: Validator<Value, "required", string>;
};

/**
 * Arguments for creating or reusing a durable run.
 *
 * @public
 */
export type StartArgs = {
  threadId: string;
  userId?: string;
  prompt?: string;
  message?: AgentMessage | AgentMessageInput;
  key?: string;
};

/**
 * Arguments for advancing an existing run.
 *
 * @public
 */
export type ExecuteArgs<Tools extends AnyAgentTools = AnyAgentTools> = {
  runId: string;
  model?: AgentModel<Tools>;
  tools?: Tools;
  context?: AgentContextLoader | AgentContextLoader[];
  recentMessages?: number;
  excludeToolMessages?: boolean;
  signal?: AbortSignal;
};

/**
 * Convenience arguments for starting and immediately executing a run.
 *
 * @public
 */
export type SendArgs<Tools extends AnyAgentTools = AnyAgentTools> = StartArgs & {
  model?: AgentModel<Tools>;
  tools?: Tools;
  context?: AgentContextLoader | AgentContextLoader[];
  recentMessages?: number;
  excludeToolMessages?: boolean;
  signal?: AbortSignal;
};

/** @public */
export type CancelArgs = {
  runId: string;
  reason?: string;
};

/** @public */
export type ListArgs = {
  threadId: string;
  statuses?: AgentStatus[];
  paginationOpts?: PaginationOptions;
};

/** @public */
export type LinkArgs = {
  runId: string;
  workflowId: string;
};

/** @public */
export type HttpArgs = {
  runId: string;
};

/** @public */
export type ReadRunEventsArgs = {
  /** Run whose event stream should be read. */
  runId: string;
  /** Opaque resume cursor returned by a previous read or HTTP stream. */
  cursor?: string | null;
  /** Numeric stream index to replay from. Mutually exclusive with `cursor`. */
  startIndex?: number;
  /** Maximum number of events to return. Defaults to 100. */
  numItems?: number;
};

/** @public */
export type ReadRunEventsBatchArgs = {
  reads: Array<{
    runId: string;
    streamArgs: StreamQueryArgs;
  }>;
};

/** @public */
export type AgentRunEventBatchRead = AgentRunEventRead & {
  runId: string;
};

/** @public */
export type CreateThreadArgs = {
  userId?: string;
  title?: string;
  summary?: string;
};

/** @public */
export type UpdateThreadArgs = {
  threadId: string;
  patch: {
    userId?: string;
    title?: string;
    summary?: string;
    status?: "active" | "archived";
  };
};

/** @public */
export type ListThreadsArgs = {
  userId?: string;
  order?: "asc" | "desc";
  paginationOpts?: PaginationOptions;
};

/** @public */
export type SaveMessagesArgs = {
  threadId: string;
  userId?: string;
  promptMessageId?: string;
  messages: Array<AgentMessage | AgentMessageInput>;
};

/** @public */
export type ListMessagesArgs = {
  threadId: string;
  order?: "asc" | "desc";
  paginationOpts?: PaginationOptions;
  statuses?: Array<"pending" | "success" | "failed">;
  excludeToolMessages?: boolean;
  upToAndIncludingMessageId?: string;
};

/** @public */
export type ApprovalArgs = {
  runId: string;
  toolCallId: string;
  reason?: string;
};

/**
 * Define an Agent-native tool with optional Convex input validation.
 *
 * @remarks
 * Agent validates `input` before approval checks or execution. Tool definitions
 * are model-agnostic; adapters can translate their tool protocol
 * into Agent run events later.
 *
 * @public
 */
export function defineTool<T extends Validator<Value, "required", string>>(
  tool: Omit<AgentTool<Infer<T>>, "input"> & { input: T },
): AgentTool;
export function defineTool(tool: AgentTool): AgentTool;
export function defineTool(tool: unknown): AgentTool {
  return tool as AgentTool;
}

/**
 * Define an Agent-native model.
 *
 * @remarks
 * This is a type helper for provider adapters that yield Agent-owned events.
 * It does not prescribe a provider SDK, transport, or tool protocol.
 *
 * @public
 */
export function defineAgentModel<T extends AgentModel>(model: T): T {
  return model;
}

/**
 * Convex-native Agent client.
 *
 * @remarks
 * The Agent owns threads, messages, durable runs, tool approvals, and
 * Agent-specific run events. Stream is used internally as the ordered event log
 * for each run; callers should use `runs.start`, `runs.execute`, `runs.send`,
 * and `http`
 * rather than writing to Stream directly.
 *
 * @example
 * ```ts
 * const run = await supportAgent.runs.start(ctx, {
 *   threadId,
 *   prompt: "Help with my order",
 *   key: `client-message:${clientMessageId}`,
 * });
 * await supportAgent.runs.execute(ctx, { runId: run.runId, tools });
 * ```
 *
 * @public
 */
export class Agent<Tools extends AnyAgentTools = AnyAgentTools> {
  constructor(
    public component: AgentComponent,
    public options: AgentOptions<Tools>,
  ) {}

  /** Thread operations. @public */
  readonly threads = {
    create: (ctx: AgentMutationCtx, args: CreateThreadArgs = {}) =>
      this.createThread(ctx, args),
    get: (ctx: AgentQueryCtx, args: { threadId: string }) =>
      this.getThread(ctx, args),
    list: (ctx: AgentQueryCtx, args: ListThreadsArgs = {}) =>
      this.listThreads(ctx, args),
    update: (ctx: AgentMutationCtx, args: UpdateThreadArgs) =>
      this.updateThread(ctx, args),
  };

  /** Persisted message operations. @public */
  readonly messages = {
    save: (ctx: AgentMutationCtx, args: SaveMessagesArgs) =>
      this.saveMessages(ctx, args),
    list: (ctx: AgentQueryCtx, args: ListMessagesArgs) =>
      this.listMessages(ctx, args),
  };

  /** Durable run lifecycle operations. @public */
  readonly runs = {
    start: (ctx: AgentMutationCtx, args: StartArgs) => this.start(ctx, args),
    send: (ctx: AgentExecutionCtx, args: SendArgs<Tools>) => this.send(ctx, args),
    execute: (ctx: AgentExecutionCtx, args: ExecuteArgs<Tools>) =>
      this.execute(ctx, args),
    cancel: (ctx: AgentMutationCtx, args: CancelArgs) => this.cancel(ctx, args),
    get: (ctx: AgentQueryCtx, args: { runId: string }) => this.get(ctx, args),
    list: (ctx: AgentQueryCtx, args: ListArgs) => this.listRuns(ctx, args),
    link: (ctx: AgentMutationCtx, args: LinkArgs) => this.link(ctx, args),
  };

  /** Tool-call approval operations. @public */
  readonly tool = {
    list: (ctx: AgentQueryCtx, args: { runId: string }) =>
      this.listToolCalls(ctx, args),
    approve: (ctx: AgentMutationCtx, args: ApprovalArgs) =>
      this.approveToolCall(ctx, args),
    deny: (ctx: AgentMutationCtx, args: ApprovalArgs) =>
      this.denyToolCall(ctx, args),
  };

  /** Low-level run event reads for hooks, adapters, and devtools. @public */
  readonly events = {
    read: (ctx: AgentQueryCtx, args: ReadRunEventsArgs) =>
      this.readRunEvents(ctx, args),
    readBatch: (ctx: AgentQueryCtx, args: ReadRunEventsBatchArgs) =>
      this.readRunEventsBatch(ctx, args),
  };

  /** Create a thread for messages and runs. @internal */
  private async createThread(
    ctx: AgentMutationCtx,
    args: CreateThreadArgs = {},
  ): Promise<ThreadDoc> {
    return await ctx.runMutation(this.component.threads.createThread, {
      ...args,
    });
  }

  /** Read one thread by id. @internal */
  private async getThread(
    ctx: AgentQueryCtx,
    args: { threadId: string },
  ): Promise<ThreadDoc | null> {
    return await ctx.runQuery(this.component.threads.getThread, {
      threadId: toComponentThreadId(args.threadId),
    });
  }

  /** List threads, optionally scoped to a user id. @internal */
  private async listThreads(ctx: AgentQueryCtx, args: ListThreadsArgs = {}) {
    return await ctx.runQuery(this.component.threads.listThreadsByUserId, args);
  }

  /** Patch thread metadata. @internal */
  private async updateThread(
    ctx: AgentMutationCtx,
    args: UpdateThreadArgs,
  ): Promise<ThreadDoc> {
    return await ctx.runMutation(this.component.threads.updateThread, {
      threadId: toComponentThreadId(args.threadId),
      patch: args.patch,
    });
  }

  /** Save multiple messages in one mutation. @internal */
  private async saveMessages(
    ctx: AgentMutationCtx,
    args: SaveMessagesArgs,
  ): Promise<AgentMessageDoc[]> {
    const result = await ctx.runMutation(this.component.messages.addMessages, {
      threadId: toComponentThreadId(args.threadId),
      userId: args.userId,
      promptMessageId: maybeComponentMessageId(args.promptMessageId),
      agentName: this.options.name,
      messages: args.messages.map(normalizeMessage),
    });
    return result.messages;
  }

  /** List persisted thread messages. @internal */
  private async listMessages(
    ctx: AgentQueryCtx,
    args: ListMessagesArgs,
  ): Promise<PaginationResult<AgentMessageDoc>> {
    return await ctx.runQuery(this.component.messages.listMessagesByThreadId, {
      threadId: toComponentThreadId(args.threadId),
      order: args.order ?? "asc",
      paginationOpts: args.paginationOpts,
      statuses: args.statuses,
      excludeToolMessages: args.excludeToolMessages,
      upToAndIncludingMessageId: maybeComponentMessageId(args.upToAndIncludingMessageId),
    });
  }

  /**
   * Create or reuse a durable run without executing model work.
   *
   * @remarks
   * Runs are idempotent when `key` is provided. The key is scoped by agent name
   * and thread id; reusing it with different prompt/user input throws a
   * `ConvexError`.
   *
   * @internal
   */
  private async start(ctx: AgentMutationCtx, args: StartArgs): Promise<AgentRun> {
    return await ctx.runMutation(this.component.runs.start, {
      ...args,
      threadId: toComponentThreadId(args.threadId),
      agentName: this.options.name,
      message:
        args.message === undefined ? undefined : normalizeMessage(args.message),
    });
  }

  /** Start and execute a run in one action. @internal */
  private async send(ctx: AgentExecutionCtx, args: SendArgs<Tools>): Promise<AgentRun> {
    const {
      model,
      tools,
      context,
      recentMessages,
      excludeToolMessages,
      signal,
      ...startArgs
    } = args;
    const run = await this.start(ctx, startArgs);
    return await this.execute(ctx, {
      runId: run.runId,
      model,
      tools,
      context,
      recentMessages,
      excludeToolMessages,
      signal,
    });
  }

  /**
   * Advance an existing run by reading events from an Agent model.
   *
   * @remarks
   * Only one execution can claim a run at a time. Waiting and terminal runs are
   * returned without executing model work.
   *
   * @internal
   */
  private async execute(
    ctx: AgentExecutionCtx,
    args: ExecuteArgs<Tools>,
  ): Promise<AgentRun> {
    const model = args.model ?? this.options.model;
    if (!model) {
      throw new Error("Agent model is required to execute a run");
    }
    return await new AgentRunExecution({
      component: this.component,
      options: this.options,
      ctx,
      args,
      model,
      listMessages: (listArgs) => this.listMessages(ctx, listArgs),
    }).execute();
  }

  /** Cancel a non-terminal run. @internal */
  private async cancel(ctx: AgentMutationCtx, args: CancelArgs): Promise<AgentRun> {
    return await ctx.runMutation(this.component.runs.cancel, {
      runId: toComponentRunId(args.runId),
      reason: args.reason,
    });
  }

  /** Approve a waiting tool call and move the run back toward execution. @internal */
  private async approveToolCall(
    ctx: AgentMutationCtx,
    args: ApprovalArgs,
  ): Promise<AgentRun> {
    return await ctx.runMutation(this.component.runs.resolveApproval, {
      runId: toComponentRunId(args.runId),
      toolCallId: args.toolCallId,
      approved: true,
      reason: args.reason,
    });
  }

  /** Deny a waiting tool call. @internal */
  private async denyToolCall(
    ctx: AgentMutationCtx,
    args: ApprovalArgs,
  ): Promise<AgentRun> {
    return await ctx.runMutation(this.component.runs.resolveApproval, {
      runId: toComponentRunId(args.runId),
      toolCallId: args.toolCallId,
      approved: false,
      reason: args.reason,
    });
  }

  /** Read one durable run. @internal */
  private async get(ctx: AgentQueryCtx, args: { runId: string }): Promise<AgentRun | null> {
    return await ctx.runQuery(this.component.runs.get, {
      runId: toComponentRunId(args.runId),
    });
  }

  /** List durable runs for a thread. @internal */
  private async listRuns(
    ctx: AgentQueryCtx,
    args: ListArgs,
  ): Promise<PaginationResult<AgentRun>> {
    return await ctx.runQuery(this.component.runs.list, {
      threadId: toComponentThreadId(args.threadId),
      statuses: args.statuses,
      paginationOpts: args.paginationOpts ?? { cursor: null, numItems: 100 },
    });
  }

  /** List bounded projected tool-call state for a run. @internal */
  private async listToolCalls(
    ctx: AgentQueryCtx,
    args: { runId: string },
  ): Promise<AgentToolCall[]> {
    return await ctx.runQuery(this.component.runs.listToolCalls, {
      runId: toComponentRunId(args.runId),
    });
  }

  /** Attach an external orchestration id, such as a workflow id, to a run. @internal */
  private async link(ctx: AgentMutationCtx, args: LinkArgs): Promise<AgentRun> {
    return await ctx.runMutation(this.component.runs.link, {
      runId: toComponentRunId(args.runId),
      workflowId: args.workflowId,
    });
  }

  /**
   * Read one page of events from a run-owned stream.
   *
   * @remarks
   * Agent users address runs, not Stream ids. Use `cursor` for normal resume
   * behavior or `startIndex` for numeric index-based replay. Omit both to read
   * from the beginning.
   *
   * @internal
   */
  private async readRunEvents(
    ctx: AgentQueryCtx,
    args: ReadRunEventsArgs,
  ): Promise<AgentRunEventRead> {
    if (args.cursor !== undefined && args.startIndex !== undefined) {
      throw new Error("cursor and startIndex are mutually exclusive");
    }
    return await ctx.runQuery(this.component.runs.readEvents, {
      runId: toComponentRunId(args.runId),
      cursor: args.cursor,
      startIndex: args.startIndex,
      numItems: args.numItems ?? 100,
    });
  }

  /**
   * Read event pages for multiple runs in one app query.
   *
   * @remarks
   * This is the Agent-level companion to Stream buffer sets. Each read is keyed
   * by `runId`; Agent resolves internal Stream ids and returns run-event pages
   * without exposing Stream component refs to application clients.
   *
   * @internal
   */
  private async readRunEventsBatch(
    ctx: AgentQueryCtx,
    args: ReadRunEventsBatchArgs,
  ): Promise<AgentRunEventBatchRead[]> {
    return await ctx.runQuery(this.component.runs.readEventsBatch, {
      reads: args.reads.map((read) => ({
        runId: toComponentRunId(read.runId),
        streamArgs: read.streamArgs,
      })),
    });
  }

  /**
   * Serve a run's internal event stream from an authorized HTTP route.
   *
   * @remarks
   * This method does not authenticate the request. App HTTP routes should
   * authorize `runId` first, then call this method and expose the returned
   * Agent/Stream correlation headers in CORS when needed.
   *
   * @public
   */
  async http(ctx: AgentHttpCtx, request: Request, args: HttpArgs): Promise<Response> {
    const run = await this.get(ctx, { runId: args.runId });
    if (!run) {
      return new Response("Run not found", { status: 404 });
    }
    if (!run.streamId) {
      return new Response("Run does not have a stream", { status: 409 });
    }

    const response = await serveHttpStream<AgentRunEvent>(ctx, request, {
      streamId: run.streamId,
      read: async (ctx, readArgs) => {
        const result = await ctx.runQuery(this.component.runs.readEvents, {
          runId: toComponentRunId(run.runId),
          cursor: readArgs.cursor,
          numItems: readArgs.numItems,
        });
        return { ...result, status: result.streamStatus };
      },
    });

    response.headers.set("X-Agent-Run-Id", run.runId);
    response.headers.set("X-Agent-Thread-Id", run.threadId);
    if (run.messageId) {
      response.headers.set("X-Agent-Message-Id", run.messageId);
    }
    return response;
  }
}

export {
  v,
  vAgentError,
  vAgentMessage,
  vAgentMessageDoc,
  vAgentMessageInput,
  vAgentRunEvent,
  vAgentStatus,
  vAgentUsage,
  vThreadStatus,
  vThreadDoc,
  type AgentError,
  type AgentMessage,
  type AgentMessageContent,
  type AgentMessageDoc,
  type AgentMessageInput,
  type AgentMessagePart,
  type AgentRunEvent,
  type AgentStatus,
  type AgentToolCall,
  type AgentUsage,
  type ThreadDoc,
};

export {
  createAgentRunState,
  handleAgentRunStream,
  mergeAgentRunEvents,
  type AgentFilePart,
  type AgentRunEventRead,
  type AgentRunEventItem,
  type AgentRunState,
  type AgentRunStateHandle,
  type AgentRunStateToolCall,
  type AgentSourcePart,
  type HandleAgentRunStreamOptions,
} from "./runEvents.js";
