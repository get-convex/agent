import {
  smoothStream,
  type AsyncIterableStream,
  type ChunkDetector,
  type StreamTextTransform,
  type TextStreamPart,
  type ToolSet,
  type UIMessageChunk,
} from "ai";
import { v } from "convex/values";
import { errorToString } from "../../errors.js";
import {
  vMessageDoc,
  vPaginationResult,
  vStreamDelta,
  vStreamMessage,
  type ProviderOptions,
  type StreamArgs,
  type StreamDelta,
  type StreamMessage,
} from "../../validators.js";
import type {
  ActionCtx,
  AgentComponent,
  MutationCtx,
  QueryCtx,
  SyncStreamsReturnValue,
} from "./types.js";

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
  ctx: QueryCtx | MutationCtx | ActionCtx,
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
  ctx: MutationCtx | ActionCtx,
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
  ctx: QueryCtx | MutationCtx | ActionCtx,
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
 *
 * @param options The options passed to `agent.streamText` to decide whether to
 * save deltas while streaming.
 * @param existing The transforms passed to `agent.streamText` to merge with.
 * @returns The merged transforms to pass to the underlying `streamText` call.
 */
export function mergeTransforms<TOOLS extends ToolSet>(
  options: { chunking?: StreamingOptions["chunking"] } | boolean | undefined,
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

/**
 * DeltaStreamer can be used to save a stream of "parts" by writing
 * batches of them in "deltas" to the database so clients can subscribe
 * (using the syncStreams utility and client hooks) and re-hydrate the stream.
 * You can optionally compress the parts, e.g. concatenating text deltas, to
 * optimize the data in transit.
 */
export class DeltaStreamer<T> {
  streamId: string | undefined;
  public readonly config: {
    throttleMs: number;
    onAsyncAbort: (reason: string) => Promise<void>;
    compress: ((parts: T[]) => T[]) | null;
    materialize:
      | ((parts: T[]) => Promise<{
          parts: T[];
          fileRefs: Array<{ url: string; fileId: string }>;
        }>)
      | null;
  };
  #nextParts: T[] = [];
  #latestWrite: number = 0;
  #ongoingWrite: Promise<void> | undefined;
  #abortPromise: Promise<void> | undefined;
  #cursor: number = 0;
  public abortController: AbortController;
  // When true, the stream will be finished externally (e.g., atomically via addMessages)
  // and consumeStream should skip calling finish().
  #finishedExternally: boolean = false;

  constructor(
    public readonly component: AgentComponent,
    public readonly ctx: MutationCtx | ActionCtx,
    config: {
      throttleMs: number | undefined;
      onAsyncAbort: (reason: string) => Promise<void>;
      abortSignal: AbortSignal | undefined;
      compress: ((parts: T[]) => T[]) | null;
      materialize?: (parts: T[]) => Promise<{
        parts: T[];
        fileRefs: Array<{ url: string; fileId: string }>;
      }>;
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
      format: "UIMessageChunk" | "TextStreamPart" | undefined;
    },
  ) {
    this.config = {
      throttleMs: config.throttleMs ?? DEFAULT_STREAMING_OPTIONS.throttleMs,
      onAsyncAbort: config.onAsyncAbort,
      compress: config.compress,
      materialize: config.materialize ?? null,
    };
    this.#nextParts = [];
    this.abortController = new AbortController();
    if (config.abortSignal) {
      const abortFromSignal = () => {
        void this.#abort("abortSignal").catch(() => {
          // Best-effort cleanup — the stream timeout is the fallback.
        });
      };
      if (config.abortSignal.aborted) {
        abortFromSignal();
      } else {
        config.abortSignal.addEventListener("abort", abortFromSignal, {
          once: true,
        });
      }
    }
  }

  // Avoid race conditions by only creating once
  #creatingStreamIdPromise: Promise<string> | undefined;
  public async getStreamId() {
    if (this.abortController.signal.aborted) {
      await this.#abortPromise;
      throw new Error("Cannot create a stream after it has been aborted");
    }
    if (!this.streamId) {
      if (!this.#creatingStreamIdPromise) {
        this.#creatingStreamIdPromise = this.ctx.runMutation(
          this.component.streams.create,
          this.metadata,
        );
      }
      this.streamId = await this.#creatingStreamIdPromise;
    }
    return this.streamId;
  }

  public async addParts(parts: T[]) {
    if (this.abortController.signal.aborted) {
      return;
    }
    // Once the stream has been finished externally (e.g. by the inline
    // save in streamText's onStepFinish for the returnImmediately path),
    // the stream record is already "finished" in the DB. Late deltas
    // would be silently dropped by streams.addDelta — skip the work.
    if (this.#finishedExternally) {
      return;
    }
    const streamId = await this.getOrCreateStreamId({
      ifAborted: "returnUndefined",
    });
    if (!streamId) return;
    this.#nextParts.push(...parts);
    if (
      !this.#ongoingWrite &&
      Date.now() - this.#latestWrite >= this.config.throttleMs
    ) {
      this.#ongoingWrite = this.#sendDelta();
    }
  }

  public async consumeStream(stream: AsyncIterableStream<T>) {
    try {
      for await (const chunk of stream) {
        await this.addParts([chunk]);
      }
    } catch (error) {
      // A provider can throw while responding to an abort. Join the durable
      // abort transition here, outside the active delta writer, before
      // preserving the provider error for the caller.
      await this.#abort(errorToString(error)).catch(() => {});
      throw error;
    }
    // Skip finish if it will be handled externally (atomically with message save)
    // or if the stream was aborted (e.g., due to a failed delta write).
    // Abort cleanup owns the terminal component transition, so consumeStream
    // must wait for it instead of also trying to finish the stream.
    if (this.abortController.signal.aborted) {
      await this.#waitForAbortCleanup();
    } else if (!this.#finishedExternally) {
      await this.finish();
    }
  }

  /**
   * Mark the stream as being finished externally (e.g., atomically via addMessages).
   * When called, consumeStream() will skip calling finish() since it will be
   * handled elsewhere in the same mutation as message saving.
   */
  public markFinishedExternally(): void {
    this.#finishedExternally = true;
  }

  /**
   * Get the stream ID, waiting for it to be created if necessary.
   * Useful for passing to addMessages for atomic finish.
   */
  public async getOrCreateStreamId(): Promise<string>;
  public async getOrCreateStreamId(options: {
    ifAborted: "returnUndefined";
  }): Promise<string | undefined>;
  public async getOrCreateStreamId(options?: {
    ifAborted?: "returnUndefined";
  }): Promise<string | undefined> {
    if (options?.ifAborted !== "returnUndefined") {
      return this.getStreamId();
    }
    if (this.abortController.signal.aborted) {
      await this.#abortPromise;
      return undefined;
    }
    const streamId = await this.getStreamId();
    if (this.abortController.signal.aborted) {
      await this.#abortPromise;
      return undefined;
    }
    return streamId;
  }

  async #sendDelta() {
    if (this.abortController.signal.aborted) {
      return;
    }
    let success: boolean;
    try {
      const delta = await this.#createDelta();
      if (!delta) {
        return;
      }
      this.#latestWrite = Date.now();
      success = await this.ctx.runMutation(
        this.component.streams.addDelta,
        delta,
      );
    } catch (e) {
      await this.#abortDelta(errorToString(e));
      return;
    }
    if (!success) {
      // An in-flight #sendDelta started before markFinishedExternally()
      // will get `success === false` because the stream row is already
      // "finished". That's a benign late-write miss, not a failure —
      // don't convert it into an abort.
      if (this.#finishedExternally) {
        return;
      }
      await this.#abortDelta("async abort");
      return;
    }
    // Now that we've sent the delta, check if we need to send another one.
    if (
      this.#nextParts.length > 0 &&
      Date.now() - this.#latestWrite >= this.config.throttleMs
    ) {
      // We send again immediately with the accumulated deltas.
      this.#ongoingWrite = this.#sendDelta();
    } else {
      this.#ongoingWrite = undefined;
    }
  }

  async #createDelta(): Promise<
    | (StreamDelta & { fileRefs?: Array<{ url: string; fileId: string }> })
    | undefined
  > {
    if (this.#nextParts.length === 0) {
      return undefined;
    }
    const start = this.#cursor;
    const pendingParts = this.#nextParts;
    const end = start + pendingParts.length;
    this.#cursor = end;
    this.#nextParts = [];
    const materialized = this.config.materialize
      ? await this.config.materialize(pendingParts)
      : { parts: pendingParts, fileRefs: [] };
    const parts = this.config.compress
      ? this.config.compress(materialized.parts)
      : materialized.parts;
    if (!this.streamId) {
      throw new Error("Creating a delta before the stream is created");
    }
    return {
      streamId: this.streamId,
      start,
      end,
      parts,
      ...(materialized.fileRefs.length > 0
        ? { fileRefs: materialized.fileRefs }
        : {}),
    };
  }

  public async finish() {
    if (!this.streamId) {
      return;
    }
    try {
      await this.#ongoingWrite;
    } catch (error) {
      if (this.abortController.signal.aborted) {
        await this.#waitForAbortCleanup();
      }
      throw error;
    }
    await this.#sendDelta(); // #sendDelta checks aborted internally
    if (this.abortController.signal.aborted) {
      await this.#waitForAbortCleanup();
      return;
    }
    await this.ctx.runMutation(this.component.streams.finish, {
      streamId: this.streamId,
    });
  }

  public async fail(reason: string) {
    await this.#abort(reason);
  }

  async #abortDelta(reason: string) {
    let callbackFailure: { error: unknown } | undefined;
    try {
      await this.config.onAsyncAbort(reason);
    } catch (error) {
      callbackFailure = { error };
    }
    if (!this.#abortPromise) {
      try {
        await this.#abort(reason, false);
      } catch {
        // The stream timeout is the bounded cleanup fallback.
      }
    }
    if (callbackFailure) throw callbackFailure.error;
  }

  #abort(reason: string, waitForOngoingWrite = true): Promise<void> {
    if (!this.#abortPromise) {
      this.abortController.abort();
      this.#abortPromise = this.#abortCreatedStream(
        reason,
        waitForOngoingWrite,
      );
    }
    return this.#abortPromise;
  }

  async #waitForAbortCleanup() {
    let writeFailure: { error: unknown } | undefined;
    try {
      await this.#ongoingWrite;
    } catch (error) {
      writeFailure = { error };
    }
    try {
      await this.#abortPromise;
    } catch (error) {
      writeFailure ??= { error };
    }
    if (writeFailure) throw writeFailure.error;
  }

  async #abortCreatedStream(reason: string, waitForOngoingWrite: boolean) {
    if (this.#creatingStreamIdPromise) {
      this.streamId ??= await this.#creatingStreamIdPromise;
    }
    if (!this.streamId) return;
    let writeFailure: { error: unknown } | undefined;
    if (waitForOngoingWrite) {
      try {
        await this.#ongoingWrite;
      } catch (error) {
        writeFailure = { error };
      }
    }
    let abortFailure: { error: unknown } | undefined;
    try {
      await this.ctx.runMutation(this.component.streams.abort, {
        streamId: this.streamId,
        reason,
      });
    } catch (error) {
      abortFailure = { error };
    }
    if (writeFailure) throw writeFailure.error;
    if (abortFailure) throw abortFailure.error;
  }
}

/**
 * Compressing parts when streaming to save bandwidth in deltas.
 */

export function compressUIMessageChunks(
  parts: UIMessageChunk[],
): UIMessageChunk[] {
  const compressed: UIMessageChunk[] = [];
  for (const part of parts) {
    const last = compressed.at(-1);
    if (part.type === "text-delta" || part.type === "reasoning-delta") {
      if (last?.type === part.type && part.id === last.id) {
        last.delta += part.delta;
      } else {
        compressed.push(part);
      }
    } else {
      compressed.push(part);
    }
  }
  return compressed;
}

export function compressTextStreamParts(
  parts: TextStreamPart<ToolSet>[],
): TextStreamPart<ToolSet>[] {
  const compressed: TextStreamPart<ToolSet>[] = [];
  for (const part of parts) {
    const last = compressed.at(-1);
    if (part.type === "text-delta" || part.type === "reasoning-delta") {
      if (last?.type === part.type && part.id === last.id) {
        last.text += part.text;
      } else {
        compressed.push(part);
      }
    } else if (part.type === "file") {
      compressed.push({
        type: "file",
        file: {
          ...part.file,
          uint8Array: undefined as unknown as Uint8Array,
        },
      });
    } else {
      compressed.push(part);
    }
  }
  return compressed;
}
