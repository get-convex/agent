// See the docs at https://docs.convex.dev/agents/getting-started
import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { defaultConfig } from "./config";
import { z } from "zod/v3";

// Define an agent similarly to the AI SDK
export const storyAgent = new Agent(components.agent, {
  name: "Story Agent",
  instructions: "You tell stories with twist endings. ~ 200 words.",
  ...defaultConfig,
  stopWhen: stepCountIs(3),
  tools: {
    getCharacterNames: createTool({
      description:
        "Get the names of characters for the story. Only call this once.",
      args: z.object({
        count: z.number().describe("The number of character names to get"),
      }),
      handler: async (ctx, args) => {
        return [
          "Eleanor",
          "Henry",
          "Clara",
          "Samuel",
          "Margaret",
          "Jordan",
          "Maya",
          "Lucas",
          "Riley",
          "Aiden",
          "Elira",
          "Kaelen",
          "Seraphine",
          "Thorne",
          "Lyra",
          "Dorian",
          "Isolde",
          "Malachai",
          "Selene",
          "Victor",
        ].slice(0, args.count);
      },
    }),
  },
  textEmbeddingModel: undefined,
});
