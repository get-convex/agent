import { paginationOptsValidator, PaginationResult } from "convex/server";
import { WorkflowManager } from "@convex-dev/workflow";
import { Agent, createTool } from "@convex-dev/agent";
import type { ThreadDoc, UsageHandler } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { openai } from "@ai-sdk/openai";
import { action, httpAction, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { z } from "zod";
import { getGeocoding, getWeather } from "./weather";
import { tool } from "ai";

const usageHandler: UsageHandler = async (_ctx, args) => {
  console.log("token usage", args);
};

// Define an agent similarly to the AI SDK
export const weatherAgent = new Agent(components.agent, {
  name: "Weather Agent",
  chat: openai.chat("gpt-4o-mini"),
  textEmbedding: openai.embedding("text-embedding-3-small"),
  instructions:
    "You describe the weather for a location as if you were a TV weather reporter.",
  tools: {
    getWeather,
    getGeocoding,
  },
  maxSteps: 3,
  usageHandler,
});

export const fashionAgent = new Agent(components.agent, {
  name: "Fashion Agent",
  chat: openai.chat("gpt-4o-mini"),
  textEmbedding: openai.embedding("text-embedding-3-small"),
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
  maxSteps: 5,
  usageHandler,
});

// Create a thread from within a mutation and generate text
export const createThreadAndGenerateText = action({
  args: { location: v.string(), userId: v.optional(v.string()) },
  handler: async (ctx, { location, userId }) => {
    const { threadId, thread } = await weatherAgent.createThread(ctx, {
      userId,
      title: `Weather in ${location}`,
    });
    // Use the thread object from within an action to generate text:
    const result = await thread.generateText({
      prompt: `What is the weather in ${location}?`,
    });
    return { threadId, text: result.text };
  },
});

export const continueThread = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    // This includes previous message history from the thread automatically.
    const { thread } = await fashionAgent.continueThread(ctx, { threadId });
    const { text, messageId } = await thread.generateText({
      prompt: `What should I wear  based on the weather?`,
    });
    return { text, messageId };
  },
});

/**
 * Expose the agents as actions
 */
export const createThread = weatherAgent.createThreadMutation();
export const getForecast = weatherAgent.asTextAction({
  maxSteps: 3,
});
export const getFashionAdvice = fashionAgent.asObjectAction({
  schema: z.object({
    hat: z.string(),
    tops: z.string(),
    bottoms: z.string(),
    shoes: z.string(),
  }),
});
type Outfit = { hat: string; tops: string; bottoms: string; shoes: string };

/**
 * Use agent actions in a workflow
 * Note: you can also call regular actions that call agents within the action
 */

const workflow = new WorkflowManager(components.workflow);

export const weatherAgentWorkflow = workflow.define({
  args: { location: v.string() },
  handler: async (step, { location }): Promise<Outfit> => {
    const { threadId } = await step.runMutation(internal.example.createThread, {
      userId: "123",
    });
    const weather = await step.runAction(internal.example.getForecast, {
      threadId,
      prompt: `What is the weather in ${location}?`,
    });
    const fashionSuggestion = await step.runAction(
      internal.example.getFashionAdvice,
      { threadId, prompt: `What should I wear based on the weather?` },
    );
    console.log({ weather, fashionSuggestion });
    return fashionSuggestion;
  },
});

export const startWorkflow = mutation({
  args: { location: v.string() },
  handler: async (ctx, { location }): Promise<string> => {
    const workflowId = await workflow.start(
      ctx,
      internal.example.weatherAgentWorkflow,
      { location },
    );
    return workflowId;
  },
});

/**
 * Query & subscribe to messages & threads
 */

export const getThreads = query({
  args: { userId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    { userId, paginationOpts },
  ): Promise<PaginationResult<ThreadDoc>> => {
    const results = await ctx.runQuery(
      components.agent.threads.getThreadsByUserId,
      { userId, paginationOpts },
    );
    return results;
  },
});

export const getThreadMessages = query({
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { threadId, paginationOpts }) => {
    const messages = await ctx.runQuery(
      components.agent.messages.getThreadMessages,
      { threadId, paginationOpts },
    );
    return messages;
  },
});

export const getInProgressMessages = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const { page } = await ctx.runQuery(
      components.agent.messages.getThreadMessages,
      { threadId, statuses: ["pending"] },
    );
    return page;
  },
});

/**
 * Streaming
 */

export const streamText = action({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    const { threadId, thread } = await weatherAgent.createThread(ctx, {});
    const result = await thread.streamText({ prompt });
    for await (const chunk of result.textStream) {
      console.log(chunk);
    }
    return {
      threadId,
      text: await result.text,
      toolCalls: await result.toolCalls,
      toolResults: await result.toolResults,
    };
  },
});

// Registered in http.ts
export const streamHttpAction = httpAction(async (ctx, request) => {
  const { threadId, prompt } = (await request.json()) as {
    threadId?: string;
    prompt: string;
  };
  const { thread } = threadId
    ? await weatherAgent.continueThread(ctx, { threadId })
    : await weatherAgent.createThread(ctx, {});
  const result = await thread.streamText({ prompt });
  return result.toTextStreamResponse();
});

/**
 * Manual search
 */

export const searchMessages = action({
  args: {
    text: v.string(),
    userId: v.optional(v.string()),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, { text, userId, threadId }) => {
    return weatherAgent.fetchContextMessages(ctx, {
      userId,
      threadId,
      messages: [{ role: "user", content: text }],
      contextOptions: {
        searchOtherThreads: true,
        recentMessages: 0,
        searchOptions: {
          textSearch: true,
          vectorSearch: true,
          messageRange: { before: 0, after: 0 },
          limit: 10,
        },
      },
    });
  },
});

/**
 * Generate an object
 */

export const generateObject = action({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    const { threadId, thread } = await weatherAgent.createThread(ctx, {});
    const result = await thread.streamObject({
      schema: z.object({
        location: z.string(),
        weather: z.string(),
      }),
      prompt,
    });
    for await (const chunk of result.partialObjectStream) {
      console.log(chunk);
    }
    return { threadId, object: result.object };
  },
});

export const runAgentAsTool = action({
  args: {},
  handler: async (ctx) => {
    const agentWithTools = new Agent(components.agent, {
      chat: openai.chat("gpt-4o-mini"),
      textEmbedding: openai.embedding("text-embedding-3-small"),
      instructions: "You are a helpful assistant.",
      tools: {
        doSomething: tool({
          description: "Call this function when asked to do something",
          parameters: z.object({}),
          execute: async (args, options) => {
            console.log("doingSomething", options.toolCallId);
            return "hello";
          },
        }),
        doSomethingElse: tool({
          description: "Call this function when asked to do something else",
          parameters: z.object({}),
          execute: async (args, options) => {
            console.log("doSomethingElse", options.toolCallId);
            return "hello";
          },
        }),
      },
      maxSteps: 20,
    });
    const agentWithToolsAsTool = createTool({
      description:
        "agentWithTools which can either doSomething or doSomethingElse",
      args: z.object({
        whatToDo: z.union([
          z.literal("doSomething"),
          z.literal("doSomethingElse"),
        ]),
      }),
      handler: async (ctx, args) => {
        // Create a nested thread to call the agent with tools
        const { thread } = await agentWithTools.createThread(ctx, {
          userId: ctx.userId,
        });
        const result = await thread.generateText({
          messages: [
            {
              role: "assistant",
              content: `I'll do this now: ${args.whatToDo}`,
            },
          ],
        });
        return result.text;
      },
    });
    const dispatchAgent = new Agent(components.agent, {
      chat: openai.chat("gpt-4o-mini"),
      textEmbedding: openai.embedding("text-embedding-3-small"),
      instructions:
        "You can call agentWithToolsAsTool as many times as told with the argument whatToDo.",
      tools: { agentWithToolsAsTool },
      maxSteps: 5,
    });

    const { thread } = await dispatchAgent.createThread(ctx);
    console.time("overall");
    const result = await thread.generateText({
      messages: [
        {
          role: "user",
          content:
            "Call fastAgent with whatToDo set to doSomething three times and doSomethingElse one time",
        },
      ],
    });
    console.timeEnd("overall");
    return result.text;
  },
});
