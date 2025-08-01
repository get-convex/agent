// See the docs at https://docs.convex.dev/agents/getting-started
import { Agent } from "@convex-dev/agent";
import { chat, textEmbedding } from "../modelsForDemo";
import { components } from "../_generated/api";
import { usageHandler } from "../usage_tracking/usageHandler";

// Define an agent similarly to the AI SDK
export const storyAgent = new Agent(components.agent, {
  name: "Story Agent",
  chat,
  textEmbedding,
  instructions: "You tell stories with twist endings. ~ 200 words.",
  usageHandler,
});
