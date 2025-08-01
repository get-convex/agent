// See the docs at https://docs.convex.dev/agents/tools
import { tool } from "ai";
import { components } from "../_generated/api";
import { z } from "zod";

export const updateThreadTitle = tool({
  description:
    "Update the title of the current thread. It will respond with 'updated' if it succeeded",
  inputSchema: z.object({
    title: z.string().describe("The new title for the thread"),
  }),
});
