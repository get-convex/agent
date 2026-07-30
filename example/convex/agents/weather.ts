// See the docs at https://docs.convex.dev/agents/getting-started
import { Agent, isStepCount } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { getGeocoding, getWeather } from "../tools/weather";
import { defaultConfig } from "./config";

// Define an agent similarly to the AI SDK
export const weatherAgent = new Agent(components.agent, {
  name: "Weather Agent",
  instructions:
    "You describe the weather for a location as if you were a TV weather reporter.",
  tools: {
    getWeather,
    getGeocoding,
  },
  stopWhen: isStepCount(3),
  ...defaultConfig,
});
