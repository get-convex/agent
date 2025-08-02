import type { TextStreamPart as AITextStreamPart, ToolSet } from "ai";
import type { Infer } from "convex/values";
import { expectTypeOf, test } from "vitest";
import type { ContextOptions, StorageOptions } from "./client/types.js";
import type { TextStreamPart } from "./validators.js";
import { vContextOptions, vStorageOptions } from "./validators.js";



expectTypeOf<Infer<typeof vContextOptions>>().toExtend<ContextOptions>();
expectTypeOf<ContextOptions>().toExtend<Infer<typeof vContextOptions>>();

expectTypeOf<Infer<typeof vStorageOptions>>().toExtend<StorageOptions>();
expectTypeOf<StorageOptions>().toExtend<Infer<typeof vStorageOptions>>();

type StreamPart = Extract<
  AITextStreamPart<ToolSet>,
  {
    type:
      | "text-delta"
      | "reasoning"
      | "source"
      | "tool-call"
      | "tool-call-streaming-start"
      | "tool-call-delta"
      | "tool-result";
  }
>;
expectTypeOf<StreamPart>().toExtend<TextStreamPart>();

test("noop", () => {});
