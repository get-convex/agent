import { openrouter } from "@openrouter/ai-sdk-provider";
import { type EmbeddingModel } from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { groq } from "@ai-sdk/groq";
import { mockModel } from "@convex-dev/agent";

let languageModel: LanguageModelV2;
let textEmbeddingModel: EmbeddingModel;

if (process.env.ANTHROPIC_API_KEY) {
  languageModel = anthropic.chat("claude-opus-4-20250514");
} else if (process.env.OPENAI_API_KEY) {
  languageModel = openai.chat("gpt-4o-mini");
  textEmbeddingModel = openai.embedding("text-embedding-3-small");
} else if (process.env.GROQ_API_KEY) {
  languageModel = groq.languageModel(
    "meta-llama/llama-4-scout-17b-16e-instruct",
  );
} else if (process.env.OPENROUTER_API_KEY) {
  languageModel = openrouter.chat("openai/gpt-4o-mini") as LanguageModelV2;
} else {
  languageModel = mockModel({});
  console.warn(
    "Run `npx convex env set GROQ_API_KEY=<your-api-key>` or `npx convex env set OPENAI_API_KEY=<your-api-key>` or `npx convex env set OPENROUTER_API_KEY=<your-api-key>` from the example directory to set the API key.",
  );
}

// If you want to use different models for examples, you can change them here.
export { languageModel, textEmbeddingModel };
