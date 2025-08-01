// See the docs at https://docs.convex.dev/agents/getting-started
import { Agent, stepCountIs } from "@convex-dev/agent";
import { tool } from "ai";
import { components } from "../_generated/api";
import { z } from "zod";
import { usageHandler } from "../usage_tracking/usageHandler";
import { chat, textEmbedding } from "../modelsForDemo";

export const fashionAgent = new Agent(components.agent, {
  name: "Fashion Agent",
  chat,
  instructions:
    "You give fashion advice for a place a user is visiting, based on the weather.",
  tools: {
    getUserPreferences: tool({
      description: "Get clothing preferences for a user",
      inputSchema: z.object({
        search: z.string().describe("Which preferences are requested"),
      }),
    }),
  },
  stopWhen: stepCountIs(5),
  // optional:
  textEmbedding,
  usageHandler,
});
