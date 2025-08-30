import { type ChunkDetector, type AsyncIterableStream } from "ai";
import {
  vStreamDelta,
  vStreamMessage,
  vPaginationResult,
  type ProviderOptions,
  type StreamArgs,
  type StreamDelta,
  type StreamMessage,
} from "../validators.js";
import type {
  AgentComponent,
  RunActionCtx,
  RunMutationCtx,
  RunQueryCtx,
  SyncStreamsReturnValue,
} from "./types.js";
import { v } from "convex/values";
import { vMessageDoc } from "../component/schema.js";

export const vStreamMessagesReturnValue = v.object({
  ...vPaginationResult(vMessageDoc).fields,
  streams: v.optional(
    v.union(
      v.object({ kind: v.literal("list"), messages: v.array(vStreamMessage) }),
      v.object({ kind: v.literal("deltas"), deltas: v.array(vStreamDelta) }),
    ),
  ),
});

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
  {
    threadId,
    streamArgs,
    includeStatuses,
  }: {
    threadId: string;
    streamArgs?: StreamArgs | undefined;
    // By default, only streaming messages are included.
    includeStatuses?: ("streaming" | "finished" | "aborted")[];
  },
): Promise<SyncStreamsReturnValue | undefined> {
  if (!streamArgs) return undefined;
  if (streamArgs.kind === "list") {
    return {
      kind: "list",
      messages: await listStreams(ctx, component, {
        threadId,
        startOrder: streamArgs.startOrder,
        includeStatuses,
      }),
    };
  } else {
    return {
      kind: "deltas",
      deltas: await ctx.runQuery(component.streams.listDeltas, {
        threadId,
        cursors: streamArgs.cursors,
      }),
    };
  }
}

export async function abortStream(
  ctx: RunMutationCtx,
  component: AgentComponent,
  args: { reason: string } & (
    | { streamId: string }
    | { threadId: string; order: number }
  ),
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
  /**
   * If set to true, this will return immediately, as it would if you weren't
   * saving the deltas. Otherwise, the call will "consume" the stream with
   * .consumeStream(), which waits for the stream to finish before returning.
   *
   * When saving deltas, you're often not interactin with the stream otherwise.
   */
  returnImmediately?: boolean;
};
export const DEFAULT_STREAMING_OPTIONS = {
  // This chunks by sentences / clauses. Punctuation followed by whitespace.
  chunking: /[\p{P}\s]/u,
  throttleMs: 250,
  returnImmediately: false,
} satisfies StreamingOptions;

/**
 * DeltaStreamer can be used to save a stream of "parts" by writing
 * batches of them in "deltas" to the database so clients can subscribe
 * (using the syncStreams utility and client hooks) and re-hydrate the stream.
 * You can optionally compress the parts, e.g. concatenating text deltas, to
 * optimize the data in transit.
 */
export class DeltaStreamer<T> {
  public streamId: string | undefined;
  public readonly config: {
    stream: Required<StreamingOptions>;
    onAsyncAbort: (reason: string) => Promise<void>;
    compress: ((parts: T[]) => T[]) | null;
  };
  #nextParts: T[] = [];
  #latestWrite: number = 0;
  #ongoingWrite: Promise<void> | undefined;
  #cursor: number = 0;
  public abortController: AbortController;

  constructor(
    public readonly component: AgentComponent,
    public readonly ctx: RunActionCtx,
    config: {
      stream: true | StreamingOptions;
      onAsyncAbort: (reason: string) => Promise<void>;
      abortSignal: AbortSignal | undefined;
      compress: ((parts: T[]) => T[]) | null;
    },
    public readonly metadata: {
      threadId: string;
      userId?: string;
      order: number;
      stepOrder: number;
      agentName?: string;
      model?: string;
      provider?: string;
      providerOptions?: ProviderOptions;
    },
  ) {
    this.config = {
      stream:
        config.stream === true
          ? DEFAULT_STREAMING_OPTIONS
          : { ...DEFAULT_STREAMING_OPTIONS, ...config },
      onAsyncAbort: config.onAsyncAbort,
      compress: config.compress,
    };
    this.#nextParts = [];
    this.abortController = new AbortController();
    if (config.abortSignal) {
      config.abortSignal.addEventListener("abort", async () => {
        if (this.abortController.signal.aborted) {
          return;
        }
        if (this.streamId) {
          this.abortController.abort();
          await this.#ongoingWrite;
          await this.ctx.runMutation(this.component.streams.abort, {
            streamId: this.streamId,
            reason: "abortSignal",
          });
        }
      });
    }
  }

  public async addParts(parts: T[]) {
    if (this.abortController.signal.aborted) {
      return;
    }
    if (!this.streamId) {
      this.streamId = await this.ctx.runMutation(
        this.component.streams.create,
        this.metadata,
      );
    }
    this.#nextParts.push(...parts);
    if (
      !this.#ongoingWrite &&
      Date.now() - this.#latestWrite >= this.config.stream.throttleMs
    ) {
      this.#ongoingWrite = this.#sendDelta();
    }
  }

  public async consumeStream(stream: AsyncIterableStream<T>) {
    for await (const chunk of stream) {
      await this.addParts([chunk]);
    }
    await this.finish();
  }

  async #sendDelta() {
    if (this.abortController.signal.aborted) {
      return;
    }
    const delta = this.#createDelta();
    if (!delta) {
      return;
    }
    this.#latestWrite = Date.now();
    try {
      const success = await this.ctx.runMutation(
        this.component.streams.addDelta,
        delta,
      );
      if (!success) {
        await this.config.onAsyncAbort("async abort");
        this.abortController.abort();
        return;
      }
    } catch (e) {
      await this.config.onAsyncAbort(
        e instanceof Error ? e.message : "unknown error",
      );
      this.abortController.abort();
      throw e;
    }
    // Now that we've sent the delta, check if we need to send another one.
    if (
      this.#nextParts.length > 0 &&
      Date.now() - this.#latestWrite >= this.config.stream.throttleMs
    ) {
      // We send again immediately with the accumulated deltas.
      this.#ongoingWrite = this.#sendDelta();
    } else {
      this.#ongoingWrite = undefined;
    }
  }

  #createDelta(): StreamDelta | undefined {
    if (this.#nextParts.length === 0) {
      return undefined;
    }
    const start = this.#cursor;
    const end = start + this.#nextParts.length;
    this.#cursor = end;
    const parts = this.config.compress
      ? this.config.compress(this.#nextParts)
      : this.#nextParts;
    this.#nextParts = [];
    if (!this.streamId) {
      throw new Error("Creating a delta before the stream is created");
    }
    return { streamId: this.streamId, start, end, parts };
  }

  public async finish() {
    if (!this.streamId) {
      return;
    }
    await this.#ongoingWrite;
    await this.ctx.runMutation(this.component.streams.finish, {
      streamId: this.streamId,
    });
  }

  public async fail(reason: string) {
    if (this.abortController.signal.aborted) {
      return;
    }
    this.abortController.abort();
    if (!this.streamId) {
      return;
    }
    await this.#ongoingWrite;
    await this.ctx.runMutation(this.component.streams.abort, {
      streamId: this.streamId,
      reason,
    });
  }
}
