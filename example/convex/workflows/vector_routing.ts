// See the docs at https://docs.convex.dev/agents/workflows
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { internalQuery, mutation } from "../_generated/server";
import { v } from "convex/values";
import { createThread, saveMessage, stepCountIs } from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { agent as simpleAgent } from "../agents/simple";
import { weatherAgent } from "../agents/weather";
import { storyAgent } from "../agents/story";
import { embed } from "ai";
import { textEmbeddingModel } from "../modelsForDemo";

/**
 * Vector Routing Pattern: Use vector embeddings to route requests
 *
 * This workflow demonstrates using vector embeddings and semantic similarity
 * to decide what to do next, rather than using an LLM for classification.
 * This is faster and more deterministic than LLM-based routing.
 */

const workflow = new WorkflowManager(components.workflow);

// Predefined route templates with example prompts
const routeTemplates = [
  {
    route: "weather",
    description: "Weather forecasts and climate information",
    examples: [
      "What's the weather like?",
      "Will it rain tomorrow?",
      "What's the forecast for this weekend?",
      "How hot will it be today?",
      "Should I bring an umbrella?",
    ],
  },
  {
    route: "story",
    description: "Creative storytelling and narratives",
    examples: [
      "Tell me a story",
      "Write a short tale about adventure",
      "Create a narrative with a twist ending",
      "I want to hear a creative story",
      "Make up a story for me",
    ],
  },
  {
    route: "support",
    description: "Technical support and help",
    examples: [
      "I need help with my account",
      "Something isn't working",
      "How do I use this feature?",
      "I'm having trouble",
      "Can you help me troubleshoot?",
    ],
  },
  {
    route: "general",
    description: "General questions and conversation",
    examples: [
      "What can you do?",
      "Tell me about yourself",
      "How are you?",
      "What's the meaning of life?",
      "Explain quantum computing",
    ],
  },
];

export const vectorRoutingWorkflow = workflow.define({
  args: { userMessage: v.string(), threadId: v.string() },
  returns: v.object({
    route: v.string(),
    similarity: v.number(),
    response: v.string(),
  }),
  handler: async (ctx, args) => {
    console.log("Starting vector routing workflow for:", args.userMessage);

    // Step 1: Get embedding for the user's message
    const userEmbedding = await ctx.runQuery(
      internal.workflows.vector_routing.getEmbedding,
      { text: args.userMessage },
    );

    console.log("User embedding generated");

    // Step 2: Get embeddings for all route examples and find best match
    const routeMatch = await ctx.runQuery(
      internal.workflows.vector_routing.findBestRoute,
      {
        userEmbedding: userEmbedding.embedding,
        routes: routeTemplates,
      },
    );

    console.log("Best route match:", routeMatch);

    // Step 3: Save the user's message
    const userMsg = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: args.userMessage,
    });

    // Step 4: Route to the appropriate handler based on vector similarity
    let response: string;
    switch (routeMatch.route) {
      case "weather":
        response = await ctx.runAction(
          internal.workflows.vector_routing.handleWeather,
          {
            promptMessageId: userMsg.messageId,
            threadId: args.threadId,
          },
          { retry: true },
        );
        break;

      case "story":
        response = await ctx.runAction(
          internal.workflows.vector_routing.handleStory,
          {
            promptMessageId: userMsg.messageId,
            threadId: args.threadId,
          },
          { retry: true },
        );
        break;

      case "support":
        response = await ctx.runAction(
          internal.workflows.vector_routing.handleSupport,
          {
            promptMessageId: userMsg.messageId,
            threadId: args.threadId,
          },
          { retry: true },
        );
        break;

      default:
        response = await ctx.runAction(
          internal.workflows.vector_routing.handleGeneral,
          {
            promptMessageId: userMsg.messageId,
            threadId: args.threadId,
          },
          { retry: true },
        );
        break;
    }

    return {
      route: routeMatch.route,
      similarity: routeMatch.similarity,
      response,
    };
  },
});

// Get embedding for text
export const getEmbedding = internalQuery({
  args: { text: v.string() },
  handler: async (_ctx, args) => {
    const result = await embed({
      model: textEmbeddingModel,
      value: args.text,
    });
    return {
      embedding: result.embedding,
    };
  },
});

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Find best matching route using vector similarity
export const findBestRoute = internalQuery({
  args: {
    userEmbedding: v.array(v.number()),
    routes: v.array(
      v.object({
        route: v.string(),
        description: v.string(),
        examples: v.array(v.string()),
      }),
    ),
  },
  handler: async (_ctx, args) => {
    let bestRoute = "general";
    let bestSimilarity = 0;

    // For each route, compute average similarity across all examples
    for (const routeTemplate of args.routes) {
      let totalSimilarity = 0;

      for (const example of routeTemplate.examples) {
        // Get embedding for this example
        const exampleEmbedding = await embed({
          model: textEmbeddingModel,
          value: example,
        });

        // Calculate similarity
        const similarity = cosineSimilarity(
          args.userEmbedding,
          exampleEmbedding.embedding,
        );
        totalSimilarity += similarity;
      }

      // Average similarity for this route
      const avgSimilarity = totalSimilarity / routeTemplate.examples.length;

      console.log(
        `Route "${routeTemplate.route}" similarity: ${avgSimilarity}`,
      );

      if (avgSimilarity > bestSimilarity) {
        bestSimilarity = avgSimilarity;
        bestRoute = routeTemplate.route;
      }
    }

    return {
      route: bestRoute,
      similarity: bestSimilarity,
    };
  },
});

// Route handlers
export const handleWeather = weatherAgent.asTextAction({
  stopWhen: stepCountIs(3),
});

export const handleStory = storyAgent.asTextAction({
  stopWhen: stepCountIs(3),
});

export const handleSupport = simpleAgent.asTextAction({
  instructions: `You are a helpful technical support assistant. Help the user with their issue, ask clarifying questions, and provide step-by-step guidance.`,
  stopWhen: stepCountIs(3),
});

export const handleGeneral = simpleAgent.asTextAction({
  instructions: `You are a friendly, helpful assistant. Answer questions concisely and accurately.`,
  stopWhen: stepCountIs(2),
});

// Mutation to start the vector routing workflow
export const startVectorRouting = mutation({
  args: { userMessage: v.string() },
  handler: async (ctx, args): Promise<{ threadId: string; workflowId: string }> => {
    const userId = await getAuthUserId(ctx);
    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: `Vector Routing: ${args.userMessage.slice(0, 50)}`,
    });
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.vector_routing.vectorRoutingWorkflow,
      { userMessage: args.userMessage, threadId },
    );
    return { threadId, workflowId };
  },
});
