import {
  type ChunkDetector,
  smoothStream,
  type StreamTextTransform,
  type ToolSet,
} from "ai";
import type {
  ProviderOptions,
  StreamArgs,
  StreamDelta,
  StreamMessage,
  TextStreamPart,
} from "../validators.js";
import type { MessageDoc } from "../component/schema.js";
import type {
  AgentComponent,
  RunActionCtx,
  RunMutationCtx,
  RunQueryCtx,
  SyncStreamsReturnValue,
} from "./types.js";
import { omit } from "convex-helpers";
import { convexToJson } from "convex/values";

/**
 * A function that handles fetching stream deltas, used with the React hooks
 * `useThreadMessages` or `useStreamingThreadMessages`.
 * @param ctx A ctx object from a query, mutation, or action.
 * @param component The agent component, usually `components.agent`.
 * @param args.threadId The thread to sync streams for.
 * @param args.streamArgs The stream arguments with per-stream cursors.
 * @returns The deltas for each stream from their existing cursor.
 */
export async function syncStreams(
  ctx: RunQueryCtx,
  component: AgentComponent,
  args: {
    threadId: string;
    streamArgs: StreamArgs | undefined;
    // By default, only streaming messages are included.
    includeStatuses?: ("streaming" | "finished" | "aborted")[];
  },
): Promise<SyncStreamsReturnValue | undefined> {
  if (!args.streamArgs) return undefined;
  if (args.streamArgs.kind === "list") {
    return {
      kind: "list",
      messages: await listStreams(ctx, component, {
        threadId: args.threadId,
        startOrder: args.streamArgs.startOrder,
        includeStatuses: args.includeStatuses,
      }),
    };
  } else {
    return {
      kind: "deltas",
      deltas: await ctx.runQuery(component.streams.listDeltas, {
        threadId: args.threadId,
        cursors: args.streamArgs.cursors,
      }),
    };
  }
}

export async function abortStream(
  ctx: RunMutationCtx,
  component: AgentComponent,
  args: {
    reason: string;
  } & ({ streamId: string } | { threadId: string; order: number }),
): Promise<boolean> {
  if ("streamId" in args) {
    return await ctx.runMutation(component.streams.abort, {
      reason: args.reason,
      streamId: args.streamId,
    });
  } else {
    return await ctx.runMutation(component.streams.abortByOrder, {
      reason: args.reason,
      threadId: args.threadId,
      order: args.order,
    });
  }
}

/**
 * List the streaming messages for a thread.
 * @param ctx A ctx object from a query, mutation, or action.
 * @param component The agent component, usually `components.agent`.
 * @param args.threadId The thread to list streams for.
 * @param args.startOrder The order of the messages in the thread to start listing from.
 * @param args.includeStatuses The statuses to include in the list.
 * @returns The streams for the thread.
 */
export async function listStreams(
  ctx: RunQueryCtx,
  component: AgentComponent,
  {
    threadId,
    startOrder,
    includeStatuses,
  }: {
    threadId: string;
    startOrder?: number;
    includeStatuses?: ("streaming" | "finished" | "aborted")[];
  },
): Promise<StreamMessage[]> {
  return ctx.runQuery(component.streams.list, {
    threadId,
    startOrder,
    statuses: includeStatuses,
  });
}

export type StreamingOptions = {
  /**
   * The minimum granularity of deltas to save.
   * Note: this is not a guarantee that every delta will be exactly one line.
   * E.g. if "line" is specified, it won't save any deltas until it encounters
   * a newline character.
   * Defaults to a regex that chunks by punctuation followed by whitespace.
   */
  chunking?: "word" | "line" | RegExp | ChunkDetector;
  /**
   * The minimum number of milliseconds to wait between saving deltas.
   * Defaults to 250.
   */
  throttleMs?: number;
};
export const DEFAULT_STREAMING_OPTIONS = {
  // This chunks by sentences / clauses. Punctuation followed by whitespace.
  chunking: /[\p{P}\s]/u,
  throttleMs: 250,
} satisfies StreamingOptions;

export function mergeTransforms<TOOLS extends ToolSet>(
  options: StreamingOptions | boolean | undefined,
  existing:
    | StreamTextTransform<TOOLS>
    | Array<StreamTextTransform<TOOLS>>
    | undefined,
) {
  if (!options) {
    return existing;
  }
  const chunking =
    typeof options === "boolean"
      ? DEFAULT_STREAMING_OPTIONS.chunking
      : options.chunking;
  const transforms = Array.isArray(existing)
    ? existing
    : existing
      ? [existing]
      : [];
  transforms.push(smoothStream({ delayInMs: null, chunking }));
  return transforms;
}

export class DeltaStreamer {
  public streamId: string | undefined;
  public readonly options: Required<StreamingOptions>;
  #nextParts: TextStreamPart[] = [];
  #nextOrder: number;
  #nextStepOrder: number;
  #latestWrite: number = 0;
  #ongoingWrite: Promise<void> | undefined;
  #cursor: number = 0;
  #draining: boolean = false;
  public abortController: AbortController;

  constructor(
    public readonly component: AgentComponent,
    public readonly ctx: RunActionCtx,
    options: true | StreamingOptions,
    public readonly metadata: {
      threadId: string;
      promptMessageId: string | undefined;
      agentName: string | undefined;
      model: string | undefined;
      provider: string | undefined;
      providerOptions: ProviderOptions | undefined;
      userId: string | undefined;
      order: number | undefined;
      stepOrder: number | undefined;
      abortSignal: AbortSignal | undefined;
    },
  ) {
    this.options =
      typeof options === "boolean"
        ? DEFAULT_STREAMING_OPTIONS
        : {
            ...DEFAULT_STREAMING_OPTIONS,
            ...options,
          };
    this.#nextParts = [];
    this.#nextOrder = metadata.order ?? 0;
    this.#nextStepOrder = (metadata.stepOrder ?? 0) + 1;
    this.abortController = new AbortController();
    if (metadata.abortSignal) {
      metadata.abortSignal.addEventListener("abort", async () => {
        if (this.streamId) {
          const reason = metadata.abortSignal?.reason
            ? typeof metadata.abortSignal.reason === "string"
              ? metadata.abortSignal.reason
              : JSON.stringify(convexToJson(metadata.abortSignal.reason))
            : "abortSignal";
          await this.fail(reason);
        }
        this.abortController.abort(metadata.abortSignal?.reason);
      });
    }
  }
  public async addParts(parts: TextStreamPart[]) {
    if (this.abortController.signal.aborted) {
      return;
    }
    if (!this.streamId) {
      this.streamId = await this.ctx.runMutation(
        this.component.streams.create,
        {
          ...omit(this.metadata, ["abortSignal", "promptMessageId"]),
          order: this.#nextOrder,
          stepOrder: this.#nextStepOrder,
        },
      );
    }
    this.#nextParts.push(...parts);
    if (
      !this.#ongoingWrite &&
      Date.now() - this.#latestWrite >= this.options.throttleMs
    ) {
      this.#ongoingWrite = this.#sendDelta();
    }
  }

  async #sendDelta() {
    if (this.abortController.signal.aborted) {
      return;
    }
    const delta = this.#createDelta();
    this.#latestWrite = Date.now();
    try {
      const success = await this.ctx.runMutation(
        this.component.streams.addDelta,
        delta,
      );
      if (!success) {
        this.abortController.abort();
      }
    } catch (e) {
      this.abortController.abort();
      throw e;
    }
    // Now that we've sent the delta, check if we need to send another one.
    if (
      this.#nextParts.length > 0 &&
      Date.now() - this.#latestWrite >= this.options.throttleMs &&
      !this.abortController.signal.aborted &&
      !this.#draining
    ) {
      // We send again immediately with the accumulated deltas.
      this.#ongoingWrite = this.#sendDelta();
    } else {
      this.#ongoingWrite = undefined;
    }
  }

  #createDelta(): StreamDelta {
    const start = this.#cursor;
    const end = start + this.#nextParts.length;
    this.#cursor = end;
    const parts = this.#nextParts;
    this.#nextParts = [];
    if (!this.streamId) {
      throw new Error("Creating a delta before the stream is created");
    }
    return {
      streamId: this.streamId,
      start,
      end,
      parts,
    };
  }

  public async fail(reason: string) {
    if (this.streamId) {
      this.#draining = true;
      if (this.#ongoingWrite) {
        await this.#ongoingWrite;
      }
      // TODO: const delta = this.#createDelta();
      await this.ctx.runMutation(this.component.streams.abort, {
        streamId: this.streamId,
        reason,
        // finalDelta: delta,
      });
    } else if (this.metadata.promptMessageId) {
      await this.ctx.runMutation(this.component.messages.addFailedMessage, {
        ...omit(this.metadata, ["abortSignal", "order", "stepOrder"]),
        promptMessageId: this.metadata.promptMessageId,
        error: reason,
      });
    }
  }

  public async finish(messages: MessageDoc[]) {
    if (this.#ongoingWrite) {
      await this.#ongoingWrite;
      this.#ongoingWrite = undefined;
    }
    if (!this.streamId) {
      throw new Error("Finish called before stream is created");
    }
    const lastMessage = messages.at(-1);
    if (lastMessage) {
      this.#nextOrder = lastMessage.order;
      this.#nextStepOrder = lastMessage.stepOrder + 1;
    } else {
      console.warn("Step finished without generating a message");
    }
    const finalDelta =
      this.#nextParts.length > 0 ? this.#createDelta() : undefined;
    this.#nextParts = [];
    const streamId = this.streamId;
    this.streamId = undefined;
    this.#cursor = 0;
    await this.ctx.runMutation(this.component.streams.finish, {
      streamId,
      finalDelta,
    });
  }
}
