import type {
  LanguageModelV2,
  LanguageModelV3,
  LanguageModelV4,
} from "@ai-sdk/provider";
import { expectTypeOf, test } from "vitest";
import type {
  ActionCtx,
  AgentComponent,
  AgentPrompt,
  Config,
} from "./types.js";
import { Agent } from "../index.js";
import { startGeneration } from "./start.js";
import { gateway, tool } from "ai";
import { z } from "zod";

expectTypeOf<{ languageModel: string }>().toExtend<Config>();
expectTypeOf<{ languageModel: LanguageModelV4 }>().toExtend<Config>();
expectTypeOf<{ languageModel: LanguageModelV3 }>().not.toExtend<Config>();

expectTypeOf<{ model: string }>().toExtend<AgentPrompt>();
expectTypeOf<{ model: LanguageModelV4 }>().toExtend<AgentPrompt>();
expectTypeOf<{ model: LanguageModelV3 }>().not.toExtend<AgentPrompt>();

// Checked by tsc without executing a model call or requiring a deployment.
function checkModelOptions(
  component: AgentComponent,
  ctx: ActionCtx,
  model: LanguageModelV4,
  oldModelV2: LanguageModelV2,
  oldModelV3: LanguageModelV3,
) {
  const agent = new Agent(component, {
    name: "Model options",
    languageModel: gateway("openai/gpt-5-mini"),
    tools: {
      echo: tool({
        inputSchema: z.object({ text: z.string() }),
        execute: async ({ text }) => text,
      }),
    },
  });
  new Agent(component, { name: "Model object", languageModel: model });
  new Agent(component, {
    name: "Model ID",
    languageModel: "openai/gpt-5-mini",
  });
  agent.options.languageModel = model;
  void agent.generateText(ctx, {}, { prompt: "Hello", model });
  void agent.streamText(ctx, {}, { prompt: "Hello", model });
  void startGeneration(
    ctx,
    component,
    { model, prompt: "Hello" },
    {
      agentName: "Model options",
      languageModel: model,
    },
  );
  agent.options.tools!.echo.execute!({ text: "Hello" }, {} as never);

  // @ts-expect-error The constructor requires a model.
  new Agent(component, { name: "Missing model" });
  // @ts-expect-error A required model cannot be undefined.
  new Agent(component, { name: "Undefined model", languageModel: undefined });
  // @ts-expect-error A required model cannot be null.
  new Agent(component, { name: "Null model", languageModel: null });
  // @ts-expect-error Keep rejecting v2 model interfaces.
  new Agent(component, { name: "Old model", languageModel: oldModelV2 });
  // @ts-expect-error Keep rejecting v3 model interfaces.
  new Agent(component, { name: "Old model", languageModel: oldModelV3 });
  // @ts-expect-error Per-call overrides retain the existing model policy.
  void agent.generateText(ctx, {}, { prompt: "Hello", model: oldModelV3 });
  void startGeneration(
    ctx,
    component,
    { model, prompt: "Hello" },
    {
      agentName: "Old model",
      // @ts-expect-error Standalone config retains the existing model policy.
      languageModel: oldModelV3,
    },
  );
  // @ts-expect-error Tool input inference must stay intact.
  agent.options.tools!.echo.execute!({ text: 123 }, {} as never);
}

test("model option types", () => {
  expectTypeOf(checkModelOptions).toBeFunction();
});
