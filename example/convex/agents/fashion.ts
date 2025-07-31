// See the docs at https://docs.convex.dev/agents/getting-started
import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { z } from "zod";
import { usageHandler } from "../usage_tracking/usageHandler";
import { chat, textEmbedding } from "../modelsForDemo";

export const fashionAgent = new Agent(components.agent, {
  name: "Fashion Agent",
  chat: chat as any,
  instructions:
    "You give fashion advice for a place a user is visiting, based on the weather.",
  tools: {
    getUserPreferences: createTool({
      description: "Get clothing preferences for a user",
      args: z.object({
        search: z.string().describe("Which preferences are requested"),
      }),
      handler: async (ctx, args) => {
        console.log("getting user preferences", args);
        return {
          userId: ctx.userId,
          threadId: ctx.threadId,
          search: args.search,
          information: `The user likes to look stylish`,
        };
      },
    }),
  },
  stopWhen: stepCountIs(5),
  // optional:
  textEmbedding,
  usageHandler,
});
