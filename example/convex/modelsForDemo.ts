// import { openrouter } from "@openrouter/ai-sdk-provider";
import type { EmbeddingModel } from "ai";
import type { LanguageModelV1 } from "@ai-sdk/provider";
import { openai } from "@ai-sdk/openai";
import { groq } from "@ai-sdk/groq";

let chat: any;
let textEmbedding: EmbeddingModel<string>;

if (process.env.OPENAI_API_KEY) {
  chat = openai.languageModel("gpt-4o-mini") as any;
  textEmbedding = openai.embedding("text-embedding-3-small");
} else if (process.env.GROQ_API_KEY) {
  chat = groq.languageModel("meta-llama/llama-4-scout-17b-16e-instruct") as any;
  // } else if (process.env.OPENROUTER_API_KEY) {
  //   chat = openrouter.chat("openai/gpt-4o-mini") as LanguageModelV2;
} else {
  throw new Error(
    "Run `npx convex env set GROQ_API_KEY=<your-api-key>` or `npx convex env set OPENAI_API_KEY=<your-api-key>` or `npx convex env set OPENROUTER_API_KEY=<your-api-key>` from the example directory to set the API key.",
  );
}

// If you want to use different models for examples, you can change them here.
export { chat, textEmbedding };
