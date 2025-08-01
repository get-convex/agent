// See the docs at https://docs.convex.dev/agents/rag
import { tool } from "ai";
import { RAG } from "@convex-dev/rag";
import { v } from "convex/values";
import { z } from "zod";
import { components, internal } from "../_generated/api";
import { action } from "../_generated/server";
import { agent } from "../agents/simple";
import { getAuthUserId } from "../utils";
import { textEmbeddingV1 } from "../modelsForDemo";

const rag = new RAG(components.rag, {
  textEmbeddingModel: textEmbeddingV1,
  embeddingDimension: 1536,
});

export const sendMessage = action({
  args: { threadId: v.string(), prompt: v.string() },
  handler: async (ctx, { threadId, prompt }) => {
    const userId = await getAuthUserId(ctx);
    const { thread } = await agent.continueThread(ctx, { threadId });
    const { messageId } = await thread.generateText({
      prompt,
      tools: {
        addContext: tool({
          description: "Store information to search later via RAG",
          inputSchema: z.object({
            title: z.string().describe("The title of the context"),
            text: z.string().describe("The text body of the context"),
          }),
        }),
        searchContext: tool({
          description: "Search for context related to this user prompt",
          inputSchema: z.object({
            query: z
              .string()
              .describe("Describe the context you're looking for"),
          }),
        }),
      },
    });
  },
});
