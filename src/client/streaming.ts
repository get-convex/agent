import {
  type ChunkDetector,
  smoothStream,
  type StreamTextTransform,
  type UIMessageChunk,
  type ToolSet,
  type AsyncIterableStream,
} from "ai";
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
import { omit } from "convex-helpers";
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
  #nextParts: UIMessageChunk<ToolSet>[] = [];
  #latestWrite: number = 0;
  #ongoingWrite: Promise<void> | undefined;
  #cursor: number = 0;
  public abortController: AbortController;

  constructor(
    public readonly component: AgentComponent,
    public readonly ctx: RunActionCtx,
    options: true | StreamingOptions,
    public readonly metadata: {
      threadId: string;
      userId?: string;
      order: number;
      stepOrder: number;
      agentName?: string;
      model?: string;
      provider?: string;
      providerOptions?: ProviderOptions;
      abortSignal?: AbortSignal;
    },
  ) {
    this.options =
      typeof options === "boolean"
        ? DEFAULT_STREAMING_OPTIONS
        : { ...DEFAULT_STREAMING_OPTIONS, ...options };
    this.#nextParts = [];
    this.abortController = new AbortController();
    if (metadata.abortSignal) {
      metadata.abortSignal.addEventListener("abort", async () => {
        this.abortController.abort();
        if (!this.streamId) return;
        // add an abort UIMessagePart to the stream and flush
        this.#nextParts.push({ type: "abort" });

        await this.ctx.runMutation(this.component.streams.abort, {
          streamId: this.streamId,
          reason: "abortSignal",
          finalDelta: this.#createDelta(),
        });
      });
    }
  }

  public reset(updates: {
    order?: number;
    stepOrder?: number;
    agentName?: string;
    model?: string;
    provider?: string;
    providerOptions?: ProviderOptions;
  }) {
    this.streamId = undefined;
    this.#nextParts = [];
    this.#cursor = 0;
    Object.assign(this.metadata, {
      ...updates,
      order: updates.order ?? this.metadata.order,
      stepOrder: updates.stepOrder ?? this.metadata.stepOrder,
    });
  }

  public async consumeStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stream: AsyncIterableStream<UIMessageChunk<any>>,
  ) {
    this.streamId = await this.ctx.runMutation(this.component.streams.create, {
      ...omit(this.metadata, ["abortSignal"]),
      order: this.metadata.order,
    });
    for await (const chunk of stream) {
      if (this.abortController.signal.aborted) {
        break;
      }
      this.#nextParts.push(chunk);
      if (
        !this.#ongoingWrite &&
        Date.now() - this.#latestWrite >= this.options.throttleMs
      ) {
        this.#ongoingWrite = this.#sendDelta();
      }
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
        this.abortController.abort();
      }
    } catch (e) {
      this.abortController.abort();
      throw e;
    }
    // Now that we've sent the delta, check if we need to send another one.
    if (
      this.#nextParts.length > 0 &&
      Date.now() - this.#latestWrite >= this.options.throttleMs
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
    const parts = compressUIMessageChunks(this.#nextParts);
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
    const finalDelta = this.#createDelta();
    await this.#ongoingWrite;
    await this.ctx.runMutation(this.component.streams.finish, {
      streamId: this.streamId,
      finalDelta,
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
    const finalDelta = this.#createDelta();
    await this.#ongoingWrite;
    await this.ctx.runMutation(this.component.streams.abort, {
      streamId: this.streamId,
      reason,
      finalDelta,
    });
  }
}

export function compressUIMessageChunks(
  parts: UIMessageChunk<ToolSet>[],
): UIMessageChunk<ToolSet>[] {
  const compressed: UIMessageChunk<ToolSet>[] = [];
  for (const part of parts) {
    const last = compressed.at(-1);
    if (part.type === "text-delta" && last?.type === "text-delta") {
      last.delta += part.delta;
    } else if (
      part.type === "reasoning-delta" &&
      last?.type === "reasoning-delta"
    ) {
      last.delta += part.delta;
    } else {
      compressed.push(part);
    }
  }
  return compressed;
}
