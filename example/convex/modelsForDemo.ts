import { openrouter } from "@openrouter/ai-sdk-provider";
import { type EmbeddingModel } from "ai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { openai } from "@ai-sdk/openai";
import { groq } from "@ai-sdk/groq";
import { mockModel } from "@convex-dev/agent";
import { google } from "@ai-sdk/google";

let languageModel: LanguageModelV2;
let textEmbeddingModel: EmbeddingModel<string>;

if (process.env.OPENAI_API_KEY) {
  languageModel = openai.chat("gpt-4o-mini");
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

if (process.env.OPENAI_API_KEY) {
  textEmbeddingModel = openai.textEmbeddingModel("text-embedding-3-small");
} else if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  textEmbeddingModel = google.textEmbedding("gemini-embedding-001");
}

// If you want to use different models for examples, you can change them here.
export { languageModel, textEmbeddingModel };
