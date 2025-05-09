import {
  paginationOptsValidator,
  queryGeneric,
  mutationGeneric,
  actionGeneric,
  GenericDataModel,
  GenericQueryCtx,
  FilterApi,
  FunctionReference,
  ApiFromModules,
} from "convex/server";
import { vThreadDoc, type Agent } from "./index";
import type { RunQueryCtx, UseApi } from "./types";
import type { ToolSet } from "ai";
import { v } from "convex/values";
import { Mounts } from "../component/_generated/api";
import {
  paginationResultValidator,
  vContextOptions,
  vMessage,
} from "../validators";
import { assert } from "convex-helpers";

export type PlaygroundAPI = ApiFromModules<{
  playground: ReturnType<typeof definePlaygroundAPI<GenericDataModel>>;
}>["playground"];

// Playground API definition
export function definePlaygroundAPI<DataModel extends GenericDataModel>(
  component: UseApi<Mounts>,
  {
    agents,
    userNameLookup,
  }: {
    agents: Agent<ToolSet>[];
    userNameLookup?: (
      ctx: GenericQueryCtx<DataModel>,
      userId: string
    ) => string | Promise<string>;
  }
) {
  // Map agent name to instance
  const agentMap: Record<string, Agent<ToolSet>> = Object.fromEntries(
    agents.map((agent) => [agent.options.name, agent])
  );

  async function validateApiKey(ctx: RunQueryCtx, apiKey: string) {
    await ctx.runQuery(component.apiKeys.validate, { apiKey });
  }

  // List all agents
  const listAgents = queryGeneric({
    args: {
      apiKey: v.string(),
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      return Object.keys(agentMap);
    },
    returns: v.array(v.string()),
  });

  const listUsers = queryGeneric({
    args: {
      apiKey: v.string(),
      paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      const users = await ctx.runQuery(component.users.listUsersWithThreads, {
        paginationOpts: args.paginationOpts,
      });
      return {
        ...users,
        page: await Promise.all(
          users.page.map(async (userId) => ({
            id: userId,
            name: userNameLookup ? await userNameLookup(ctx, userId) : userId,
          }))
        ),
      };
    },
    returns: paginationResultValidator(
      v.object({
        id: v.string(),
        name: v.string(),
      })
    ),
  });

  // List threads for a user (query)
  const listThreads = queryGeneric({
    args: {
      apiKey: v.string(),
      userId: v.string(),
      paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      const results = await ctx.runQuery(component.threads.getThreadsByUserId, {
        userId: args.userId,
        paginationOpts: args.paginationOpts,
        order: "desc",
      });
      return {
        ...results,
        page: await Promise.all(
          results.page.map(async (thread) => {
            const {
              page: [last],
            } = await ctx.runQuery(component.messages.getThreadMessages, {
              threadId: thread._id,
              order: "desc",
              paginationOpts: {
                numItems: 1,
                cursor: null,
              },
            });
            return {
              ...thread,
              latestMessage: last?.text,
              lastMessageAt: last?._creationTime,
            };
          })
        ),
      };
    },
  });

  // List messages for a thread (query)
  const listMessages = queryGeneric({
    args: {
      apiKey: v.string(),
      threadId: v.string(),
      paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      return ctx.runQuery(component.messages.getThreadMessages, {
        threadId: args.threadId,
        paginationOpts: args.paginationOpts,
        order: "desc",
        statuses: ["success", "failed", "pending"],
      });
    },
  });

  // Create a thread (mutation)
  const createThread = mutationGeneric({
    args: {
      apiKey: v.string(),
      agentName: v.string(),
      userId: v.string(),
      title: v.optional(v.string()),
      summary: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      const agent = agentMap[args.agentName];
      if (!agent) throw new Error(`Unknown agent: ${args.agentName}`);
      return agent.createThread(ctx, {
        userId: args.userId,
        title: args.title,
        summary: args.summary,
      });
    },
  });

  // Send a message (action)
  const generateText = actionGeneric({
    args: {
      apiKey: v.string(),
      agentName: v.string(),
      userId: v.string(),
      threadId: v.string(),
      prompt: v.optional(v.string()),
      messages: v.optional(v.array(vMessage)),
      // Add more args as needed
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      const { threadId, userId, messages, prompt, agentName } = args;
      const agent = agentMap[agentName];
      if (!agent) throw new Error(`Unknown agent: ${agentName}`);
      const { thread } = await agent.continueThread(ctx, { threadId, userId });
      // Prefer messages if provided, else prompt
      assert(messages || prompt, "Must provide either messages or prompt");
      assert(!messages || !prompt, "Provide messages or prompt, not both");
      const result = await thread.generateText({ prompt, messages });
      return result;
    },
  });

  // Fetch prompt context (action)
  const fetchPromptContext = actionGeneric({
    args: {
      apiKey: v.string(),
      agentName: v.string(),
      userId: v.optional(v.string()),
      threadId: v.optional(v.string()),
      messages: v.array(vMessage),
      contextOptions: vContextOptions,
      beforeMessageId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      const agent = agentMap[args.agentName];
      if (!agent) throw new Error(`Unknown agent: ${args.agentName}`);
      return agent.fetchContextMessages(ctx, {
        userId: args.userId,
        threadId: args.threadId,
        messages: args.messages,
        contextOptions: args.contextOptions,
        beforeMessageId: args.beforeMessageId,
      });
    },
  });

  return {
    listUsers,
    listThreads,
    listMessages,
    listAgents,
    createThread,
    generateText,
    fetchPromptContext,
  };
}
