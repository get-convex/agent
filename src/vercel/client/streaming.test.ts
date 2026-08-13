import { beforeEach, describe, expect, test, vi } from "vitest";
import { createThread } from "../../client/threads.js";
import type { MutationCtx } from "../../client/types.js";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { streamText } from "ai";
import { components, initConvexTest } from "./setup.test.js";
import { mockModel } from "./mockModel.js";
import {
  compressUIMessageChunks,
  DeltaStreamer,
} from "./streaming.js";
import { getParts } from "../deltas.js";
import type { TestConvex } from "convex-test";

const defaultTestOptions = {
  throttleMs: 0,
  abortSignal: undefined,
  compress: null,
  onAsyncAbort: async () => {
    throw new Error("unexpected");
  },
};

const testMetadata = {
  order: 0,
  stepOrder: 0,
  agentName: "test agent",
  model: "test model",
  provider: "test provider",
  providerOptions: {},
  format: "UIMessageChunk" as const,
};

describe("DeltaStreamer", () => {
  let t: TestConvex<SchemaDefinition<GenericSchema, boolean>>;
  let threadId: string;
  beforeEach(async () => {
    t = initConvexTest();
    await t.run(async (ctx) => {
      threadId = await createThread(ctx, components.agent, {});
    });
  });
  test("should save chunks via DeltaStreamer", async () => {
    await t.run(async (ctx) => {
      const streamer = new DeltaStreamer(
        components.agent,
        ctx,
        { ...defaultTestOptions },
        { ...testMetadata, threadId },
      );
      const result = streamText({
        model: mockModel(),
        prompt: "Test prompt",
      });
      await streamer.consumeStream(result.toUIMessageStream());
      const streamId = streamer.streamId!;
      expect(streamId).toBeDefined();
      const deltas = await ctx.runQuery(components.agent.streams.listDeltas, {
        threadId,
        cursors: [{ cursor: 0, streamId }],
      });
      const { parts } = getParts(deltas);
      const stream = result.toUIMessageStream();
      for await (const part of stream) {
        const expected = parts.shift();
        expect(part).toEqual(expected);
      }
    });
  });
  test("should save all parts when throttleMs is 0", async () => {
    await t.run(async (ctx) => {
      const streamer = new DeltaStreamer(
        components.agent,
        ctx,
        { ...defaultTestOptions, throttleMs: 0 },
        { ...testMetadata, threadId },
      );
      const result = streamText({
        model: mockModel({
          content: [
            // The mockModel splits these into deltas based on spaces
            { type: "text", text: "A B C" },
            { type: "reasoning", text: "D E F" },
          ],
        }),
        prompt: "Test prompt",
      });
      await streamer.consumeStream(result.toUIMessageStream());
      const streamId = streamer.streamId!;
      expect(streamId).toBeDefined();
      const deltas = await ctx.runQuery(components.agent.streams.listDeltas, {
        threadId,
        cursors: [{ cursor: 0, streamId }],
      });
      const { parts } = getParts(deltas);
      const expected = [
        { type: "start" },
        { type: "start-step" },
        { type: "text-start" },
        { type: "text-delta", delta: "A" },
        { type: "text-delta", delta: " B" },
        { type: "text-delta", delta: " C" },
        { type: "text-end" },
        { type: "reasoning-start" },
        { type: "reasoning-delta", delta: "D" },
        { type: "reasoning-delta", delta: " E" },
        { type: "reasoning-delta", delta: " F" },
        { type: "reasoning-end" },
        { type: "finish-step" },
        { type: "finish" },
      ];
      for (const expectedPart of expected) {
        const part = parts.shift();
        expect(part).toBeDefined();
        expect(part).toMatchObject(expectedPart);
      }
    });
  });

  test("should save compressed parts via DeltaStreamer", async () => {
    await t.run(async (ctx) => {
      const streamer = new DeltaStreamer(
        components.agent,
        ctx,
        {
          throttleMs: 1000,
          abortSignal: undefined,
          compress: compressUIMessageChunks,
          onAsyncAbort: async () => {
            throw new Error("async abort");
          },
        },
        {
          ...testMetadata,
          threadId,
        },
      );
      const result = streamText({
        model: mockModel({
          content: [
            // The mockModel splits these into deltas based on spaces
            { type: "text", text: "A B C" },
            { type: "text", text: "D E F" },
            { type: "reasoning", text: "J K L" },
            { type: "text", text: "M N O" },
          ],
        }),
        prompt: "Test prompt",
        // experimental_transform: smoothStream({ chunking: "line" }),
        onError: (error) => {
          console.error(error);
        },
      });
      await streamer.consumeStream(result.toUIMessageStream());
      const streamId = streamer.streamId!;
      expect(streamId).toBeDefined();
      const deltas = await ctx.runQuery(components.agent.streams.listDeltas, {
        threadId,
        cursors: [{ cursor: 0, streamId }],
      });
      const { parts } = getParts(deltas);
      const expected = [
        { type: "start" },
        { type: "start-step" },
        { type: "text-start" },
        // These are collapsed into a single delta
        { type: "text-delta", delta: "A B C" },
        { type: "text-end" },
        { type: "text-start" },
        { type: "text-delta", delta: "D E F" },
        { type: "text-end" },
        { type: "reasoning-start" },
        { type: "reasoning-delta", delta: "J K L" },
        { type: "reasoning-end" },
        { type: "text-start" },
        { type: "text-delta", delta: "M N O" },
        { type: "text-end" },
        { type: "finish-step" },
        { type: "finish" },
      ];
      for (const expectedPart of expected) {
        const part = parts.shift();
        expect(part).toBeDefined();
        expect(part).toMatchObject(expectedPart);
      }
    });
  });
  test("honors a signal that was aborted before construction", async () => {
    const abortController = new AbortController();
    abortController.abort();

    await t.run(async (ctx) => {
      const streamer = new DeltaStreamer<string>(
        components.agent,
        ctx,
        { ...defaultTestOptions, abortSignal: abortController.signal },
        { ...testMetadata, threadId },
      );

      expect(streamer.abortController.signal.aborted).toBe(true);
      await streamer.addParts(["ignored"]);
      expect(streamer.streamId).toBeUndefined();
      await expect(streamer.getOrCreateStreamId()).rejects.toThrow(
        "Cannot create a stream after it has been aborted",
      );
    });
  });

  test("shares signal and fail cleanup while stream creation is in flight", async () => {
    let resolveCreate!: (streamId: string) => void;
    const creatingStream = new Promise<string>((resolve) => {
      resolveCreate = resolve;
    });
    let resolveAbort!: () => void;
    const abortingStream = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });
    const runMutation = vi
      .fn()
      .mockImplementationOnce(() => creatingStream)
      .mockImplementationOnce(() => abortingStream);
    const abortController = new AbortController();
    const streamer = new DeltaStreamer<string>(
      components.agent,
      { runMutation } as unknown as MutationCtx,
      { ...defaultTestOptions, abortSignal: abortController.signal },
      { ...testMetadata, threadId },
    );

    const streamId = streamer.getStreamId();
    abortController.abort();
    const failing = streamer.fail("creation failed");
    let failSettled = false;
    void failing.then(() => {
      failSettled = true;
    });
    resolveCreate("stream-1");
    await expect(streamId).resolves.toBe("stream-1");
    await vi.waitFor(() => expect(runMutation).toHaveBeenCalledTimes(2));

    expect(failSettled).toBe(false);
    resolveAbort();
    await failing;

    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      components.agent.streams.abort,
      { streamId: "stream-1", reason: "abortSignal" },
    );
  });

  test("aborts the component stream when a delta write fails", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("stream-1")
      .mockRejectedValueOnce(new Error("delta failed"))
      .mockResolvedValueOnce(undefined);
    let abortReason: string | undefined;
    const streamer = new DeltaStreamer<string>(
      components.agent,
      { runMutation } as unknown as MutationCtx,
      {
        ...defaultTestOptions,
        onAsyncAbort: async (reason) => {
          abortReason = reason;
        },
      },
      { ...testMetadata, threadId },
    );

    await streamer.addParts(["A"]);
    await streamer.finish();

    expect(abortReason).toBe("delta failed");
    expect(runMutation).toHaveBeenNthCalledWith(
      3,
      components.agent.streams.abort,
      { streamId: "stream-1", reason: "delta failed" },
    );
  });

  test("surfaces pending-message cleanup failure after aborting the stream", async () => {
    const pendingMessageFailure = new Error("pending message cleanup failed");
    let resolveComponentAbort!: () => void;
    const componentAborted = new Promise<void>((resolve) => {
      resolveComponentAbort = resolve;
    });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("stream-1")
      .mockRejectedValueOnce(new Error("delta failed"))
      .mockImplementationOnce(() => {
        resolveComponentAbort();
        return Promise.resolve();
      });
    const streamer = new DeltaStreamer<string>(
      components.agent,
      { runMutation } as unknown as MutationCtx,
      {
        ...defaultTestOptions,
        onAsyncAbort: async () => {
          throw pendingMessageFailure;
        },
      },
      { ...testMetadata, threadId },
    );
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield "A";
        await componentAborted;
      },
    } as unknown as Parameters<typeof streamer.consumeStream>[0];

    await expect(streamer.consumeStream(stream)).rejects.toBe(
      pendingMessageFailure,
    );

    expect(runMutation).toHaveBeenNthCalledWith(
      3,
      components.agent.streams.abort,
      { streamId: "stream-1", reason: "delta failed" },
    );
  });

  test("finishes external abort cleanup when the active delta write fails", async () => {
    const pendingMessageFailure = new Error("pending message cleanup failed");
    let rejectDelta!: (error: Error) => void;
    const deltaWrite = new Promise<never>((_, reject) => {
      rejectDelta = reject;
    });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("stream-1")
      .mockImplementationOnce(() => deltaWrite)
      .mockResolvedValueOnce(undefined);
    const streamer = new DeltaStreamer<string>(
      components.agent,
      { runMutation } as unknown as MutationCtx,
      {
        ...defaultTestOptions,
        onAsyncAbort: async () => {
          throw pendingMessageFailure;
        },
      },
      { ...testMetadata, threadId },
    );

    await streamer.addParts(["A"]);
    const failing = streamer.fail("external abort");
    rejectDelta(new Error("delta failed"));

    await expect(failing).rejects.toBe(pendingMessageFailure);
    expect(runMutation).toHaveBeenNthCalledWith(
      3,
      components.agent.streams.abort,
      { streamId: "stream-1", reason: "external abort" },
    );
  });
  // TODO: test fetching partial stream data - syncStreams w/ cursors
});
