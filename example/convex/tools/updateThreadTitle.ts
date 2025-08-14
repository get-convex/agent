// See the docs at https://docs.convex.dev/agents/tools
import { createTool } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { z } from "zod/v3";

export const updateThreadTitle = createTool({
  args: z.object({
    title: z.string().describe("The new title for the thread"),
  }),
  description:
    "Update the title of the current thread. It will respond with 'updated' if it succeeded",
  handler: async (ctx, args) => {
    if (!ctx.threadId) {
      console.warn("updateThreadTitle called without a threadId");
      return "missing or invalid threadId";
    }
    await ctx.runMutation(components.agent.threads.updateThread, {
      threadId: ctx.threadId,
      patch: { title: args.title },
    });
    return "updated";
  },
});
