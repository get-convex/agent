/// <reference types="vite/client" />
import { beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import type {
  FunctionReference,
  GenericSchema,
  PaginationOptions,
  PaginationResult,
  SchemaDefinition,
} from "convex/server";
import type { Infer } from "convex/values";
import { parse } from "convex-helpers/validators";
import type { TestConvex } from "convex-test";
import { components, initConvexTest } from "./setup.test.js";
import { createThread, saveMessages } from "./index.js";
import {
  DeltaStreamer,
  listMessagesWithStreams,
  listUIMessagesWithStreams,
  vStreamMessagesReturnValue,
  vStreamUIMessagesReturnValue,
} from "./streaming.js";
import type { StreamQuery } from "../react/types.js";
import type {
  UIMessageLike,
  UIMessagesQuery,
} from "../react/useUIMessages.js";
import { vUIMessage, type UIMessage } from "../UIMessages.js";
import type { StreamArgs } from "../validators.js";

/**
 * Type-level tests: a from-scratch streaming query built with
 * `listUIMessagesWithStreams` (and optionally the exported `returns`
 * validators) must satisfy both the validators and the React hooks.
 */

// The runtime UIMessage type matches the vUIMessage validator.
expectTypeOf<UIMessage>().toExtend<Infer<typeof vUIMessage>>();
expectTypeOf<Infer<typeof vUIMessage>>().toExtend<UIMessageLike>();

// The helpers' return values satisfy the exported `returns` validators,
// so `returns: vStreamUIMessagesReturnValue` + `return
// listUIMessagesWithStreams(...)` compiles (this was the TS2719 landmine).
type UIMessagesWithStreams = Awaited<
  ReturnType<typeof listUIMessagesWithStreams>
>;
type MessagesWithStreams = Awaited<ReturnType<typeof listMessagesWithStreams>>;
expectTypeOf<UIMessagesWithStreams>().toExtend<
  Infer<typeof vStreamUIMessagesReturnValue>
>();
expectTypeOf<MessagesWithStreams>().toExtend<
  Infer<typeof vStreamMessagesReturnValue>
>();

type BaseArgs = {
  threadId: string;
  paginationOpts: PaginationOptions;
  streamArgs?: StreamArgs;
};
// The query type produced when using `returns: vStreamUIMessagesReturnValue`.
type QueryWithValidator = FunctionReference<
  "query",
  "public",
  BaseArgs,
  Infer<typeof vStreamUIMessagesReturnValue>
>;
// The query type produced when the handler returns
// `listUIMessagesWithStreams(...)` without a `returns` validator.
type QueryWithoutValidator = FunctionReference<
  "query",
  "public",
  BaseArgs,
  UIMessagesWithStreams
>;
// Both are accepted by `useUIMessages(..., { stream: true })`.
expectTypeOf<QueryWithValidator>().toExtend<StreamQuery>();
expectTypeOf<QueryWithoutValidator>().toExtend<StreamQuery>();
expectTypeOf<QueryWithValidator>().toExtend<UIMessagesQuery>();
expectTypeOf<QueryWithoutValidator>().toExtend<UIMessagesQuery>();

// A query that doesn't return `streams` at all is still rejected by
// `stream: true` (the ErrorMessage guard remains useful).
type NonStreamingQuery = FunctionReference<
  "query",
  "public",
  { threadId: string; paginationOpts: PaginationOptions },
  PaginationResult<UIMessage>
>;
expectTypeOf<NonStreamingQuery>().not.toExtend<StreamQuery>();

/**
 * Runtime tests: the values the helpers return pass the exported
 * `returns` validators, including the split-pagination fields and both
 * `streams` variants ("list" and "deltas").
 */

const streamerOptions = {
  throttleMs: 0,
  abortSignal: undefined,
  compress: null,
  onAsyncAbort: async (_reason: string) => {},
};

describe("listUIMessagesWithStreams / listMessagesWithStreams", () => {
  let t: TestConvex<SchemaDefinition<GenericSchema, boolean>>;
  let threadId: string;

  beforeEach(async () => {
    t = initConvexTest();
    await t.run(async (ctx) => {
      threadId = await createThread(ctx, components.agent, {});
    });
  });

  test("returns UIMessages and streams that satisfy the validator", async () => {
    await t.run(async (ctx) => {
      await saveMessages(ctx, components.agent, {
        threadId,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      });
      // Simulate an in-progress stream with one delta.
      const streamer = new DeltaStreamer(
        components.agent,
        ctx,
        streamerOptions,
        {
          threadId,
          order: 5,
          stepOrder: 0,
          format: "UIMessageChunk",
        },
      );
      await streamer.addParts([
        { type: "text-delta", id: "t1", delta: "Once upon a time" },
      ]);

      // kind: "list" — the first call the client hook makes.
      const result = await listUIMessagesWithStreams(ctx, components.agent, {
        threadId,
        paginationOpts: { numItems: 10, cursor: null },
        streamArgs: { kind: "list" },
      });
      expect(result.page.length).toBeGreaterThan(0);
      expect(result.streams?.kind).toBe("list");
      if (result.streams?.kind === "list") {
        expect(result.streams.messages).toHaveLength(1);
      }
      expect(parse(vStreamUIMessagesReturnValue, result)).toBeDefined();

      // kind: "deltas" — the follow-up calls with per-stream cursors.
      const withDeltas = await listUIMessagesWithStreams(
        ctx,
        components.agent,
        {
          threadId,
          paginationOpts: { numItems: 10, cursor: null },
          streamArgs: {
            kind: "deltas",
            cursors: [{ streamId: streamer.streamId!, cursor: 0 }],
          },
        },
      );
      expect(withDeltas.streams?.kind).toBe("deltas");
      if (withDeltas.streams?.kind === "deltas") {
        expect(withDeltas.streams.deltas.length).toBeGreaterThan(0);
      }
      expect(parse(vStreamUIMessagesReturnValue, withDeltas)).toBeDefined();

      // Without streamArgs (e.g. from a non-streaming pagination call).
      const noStreams = await listUIMessagesWithStreams(
        ctx,
        components.agent,
        { threadId, paginationOpts: { numItems: 10, cursor: null } },
      );
      expect(noStreams.streams).toBeUndefined();
      expect(parse(vStreamUIMessagesReturnValue, noStreams)).toBeDefined();
    });
  });

  test("returns MessageDocs and streams that satisfy the validator", async () => {
    await t.run(async (ctx) => {
      await saveMessages(ctx, components.agent, {
        threadId,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      });
      const result = await listMessagesWithStreams(ctx, components.agent, {
        threadId,
        paginationOpts: { numItems: 10, cursor: null },
        streamArgs: { kind: "list" },
      });
      expect(result.page).toHaveLength(2);
      expect(result.streams?.kind).toBe("list");
      expect(parse(vStreamMessagesReturnValue, result)).toBeDefined();
    });
  });
});
