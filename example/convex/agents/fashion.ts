// See the docs at https://docs.convex.dev/agents/getting-started
import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { z } from "zod/v3";
import { defaultConfig } from "./config";

export const fashionAgent = new Agent(components.agent, {
  name: "Fashion Agent",
  instructions:
    "You give fashion advice for a place a user is visiting, based on the weather.",
  tools: {
    getUserPreferences: createTool({
      description: "Get clothing preferences for a user",
      inputSchema: z.object({
        search: z.string().describe("Which preferences are requested"),
      }),
      execute: async (ctx, input) => {
        console.log("getting user preferences", input);
        return {
          userId: ctx.userId,
          threadId: ctx.threadId,
          search: input.search,
          information: `The user likes to look stylish`,
        };
      },
    }),
  },
  stopWhen: stepCountIs(5),
  ...defaultConfig,
});
