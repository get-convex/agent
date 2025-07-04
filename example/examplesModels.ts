import { openrouter, LanguageModelV1 } from "@openrouter/ai-sdk-provider";
import type { EmbeddingModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { groq } from "@ai-sdk/groq";

let chat: LanguageModelV1;
let textEmbedding: EmbeddingModel<string>;

if (process.env.OPENAI_API_KEY) {
  chat = openai.chat("gpt-4o-mini");
  textEmbedding = openai.textEmbeddingModel("text-embedding-3-small");
} else if (process.env.GROQ_API_KEY) {
  chat = groq.languageModel("meta-llama/llama-4-scout-17b-16e-instruct");
} else if (process.env.OPENROUTER_API_KEY) {
  chat = openrouter.chat("openai/gpt-4o-mini");
} else {
  throw new Error(
    "Run `npx convex env set GROQ_API_KEY=<your-api-key>` or `npx convex env set OPENAI_API_KEY=<your-api-key>` or `npx convex env set OPENROUTER_API_KEY=<your-api-key>` from the example directory to set the API key.",
  );
}

// If you want to use different models for examples, you can change them here.
export { chat, textEmbedding };
