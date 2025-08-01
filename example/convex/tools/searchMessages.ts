// See the docs at https://docs.convex.dev/agents/context
import { components } from "../_generated/api";
import { fetchContextMessages } from "@convex-dev/agent";
import z from "zod";
import { embed, tool } from "ai";
import { textEmbedding } from "../modelsForDemo";

/**
 * Manual search
 */

export const searchMessages = tool({
  description: "Search for messages in the thread",
  inputSchema: z.object({
    query: z.string().describe("The query to search for"),
  }),
});
