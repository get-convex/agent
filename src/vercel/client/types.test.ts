import type { LanguageModelV3, LanguageModelV4 } from "@ai-sdk/provider";
import { expectTypeOf, test } from "vitest";
import type { AgentPrompt, Config } from "./types.js";

expectTypeOf<{ languageModel: string }>().toExtend<Config>();
expectTypeOf<{ languageModel: LanguageModelV4 }>().toExtend<Config>();
expectTypeOf<{ languageModel: LanguageModelV3 }>().not.toExtend<Config>();

expectTypeOf<{ model: string }>().toExtend<AgentPrompt>();
expectTypeOf<{ model: LanguageModelV4 }>().toExtend<AgentPrompt>();
expectTypeOf<{ model: LanguageModelV3 }>().not.toExtend<AgentPrompt>();

test("noop", () => {});
