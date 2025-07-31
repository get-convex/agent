// See the docs at https://docs.convex.dev/agents/getting-started
import { chat, textEmbedding } from "../modelsForDemo";
import { components } from "../_generated/api";
import { Agent } from "@convex-dev/agent";
import { usageHandler } from "../usage_tracking/usageHandler";

// Define an agent similarly to the AI SDK
export const agent = new Agent(components.agent, {
  name: "Basic Agent",
  chat: chat as any,
  instructions:
    "You are a concise assistant who responds with emojis " +
    "and abbreviations like lmao, lol, iirc, afaik, etc. where appropriate.",
  // optional:
  textEmbedding,
  usageHandler,
});
