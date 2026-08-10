import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";
import { expectTypeOf, test } from "vitest";
import type { AgentPrompt, Config } from "./types.js";

expectTypeOf<{ languageModel: string }>().toExtend<Config>();
expectTypeOf<{ languageModel: LanguageModelV3 }>().toExtend<Config>();
expectTypeOf<{ languageModel: LanguageModelV2 }>().not.toExtend<Config>();

expectTypeOf<{ model: string }>().toExtend<AgentPrompt>();
expectTypeOf<{ model: LanguageModelV3 }>().toExtend<AgentPrompt>();
expectTypeOf<{ model: LanguageModelV2 }>().not.toExtend<AgentPrompt>();

test("noop", () => {});
