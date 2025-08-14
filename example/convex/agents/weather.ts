// See the docs at https://docs.convex.dev/agents/getting-started
import { Agent, stepCountIs } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { getGeocoding, getWeather } from "../tools/weather";
import { usageHandler } from "../usage_tracking/usageHandler";
import { chat, textEmbedding } from "../modelsForDemo";

// Define an agent similarly to the AI SDK
export const weatherAgent = new Agent(components.agent, {
  name: "Weather Agent",
  chat,
  textEmbedding,
  instructions:
    "You describe the weather for a location as if you were a TV weather reporter.",
  tools: {
    getWeather,
    getGeocoding,
  },
  stopWhen: stepCountIs(3),
  usageHandler,
});
