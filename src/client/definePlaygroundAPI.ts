import {
  paginationOptsValidator,
  queryGeneric,
  mutationGeneric,
  actionGeneric,
  type GenericDataModel,
  type GenericQueryCtx,
  type ApiFromModules,
  type GenericActionCtx,
} from "convex/server";
import {
  vMessageDoc,
  vThreadDoc,
  vPaginationResult,
  vMessage,
  vContextOptions,
  vStorageOptions,
  type AgentComponent,
  type Agent,
} from "./index.js";
import { v } from "convex/values";

export type PlaygroundAPI = ApiFromModules<{
  playground: ReturnType<typeof definePlaygroundAPI>;
}>["playground"];

export type AgentsFn<DataModel extends GenericDataModel> = (
  ctx: GenericActionCtx<DataModel> | GenericQueryCtx<DataModel>,
  args: { userId: string | undefined; threadId: string | undefined },
) => Agent[] | Promise<Agent[]>;

// Playground API definition
export function definePlaygroundAPI<DataModel extends GenericDataModel>(
  component: AgentComponent,
  {
    agents: agentsOrFn,
    userNameLookup,
  }: {
    agents: Agent[] | AgentsFn<DataModel>;
    userNameLookup?: (
      ctx: GenericQueryCtx<DataModel>,
      userId: string,
    ) => string | Promise<string>;
  },
) {
  function validateAgents(agents: Agent[]) {
    for (const agent of agents) {
      if (!agent.options.name) {
        console.warn(
          `Agent has no name (instructions: ${agent.options.instructions})`,
        );
      }
    }
  }

  async function validateApiKey(ctx: RunQueryCtx, apiKey: string) {
    await ctx.runQuery(component.apiKeys.validate, { apiKey });
  }

  const isApiKeyValid = queryGeneric({
    args: {
      apiKey: v.string(),
    },
    handler: async (ctx, args) => {
      try {
        await validateApiKey(ctx, args.apiKey);
        return true;
      } catch {
        return false;
      }
    },
    returns: v.boolean(),
  });

  async function getAgents(
    ctx: GenericActionCtx<DataModel> | GenericQueryCtx<DataModel>,
    args: { userId: string | undefined; threadId: string | undefined },
  ) {
    const agents = Array.isArray(agentsOrFn)
      ? agentsOrFn
      : await agentsOrFn(ctx, args);
    validateAgents(agents);
    return agents.map((agent, i) => ({
      name: agent.options.name ?? `Agent ${i} (missing 'name')`,
      agent,
    }));
  }

  // List all agents
  const listAgents = queryGeneric({
    args: {
      apiKey: v.string(),
      userId: v.optional(v.string()),
      threadId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
      const agents = await getAgents(ctx, {
        userId: args.userId,
        threadId: args.threadId,
      });
      await validateApiKey(ctx, args.apiKey);
      return agents.map(({ name, agent }) => ({
        name,
        instructions: agent.options.instructions,
        contextOptions: agent.options.contextOptions,
        storageOptions: agent.options.storageOptions,
        maxSteps: agent.options.maxSteps,
        maxRetries: agent.options.maxRetries,
        tools: agent.options.tools ? Object.keys(agent.options.tools) : [],
      }));
    },
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
            _id: userId,
            name: userNameLookup ? await userNameLookup(ctx, userId) : userId,
          })),
        ),
      };
    },
    returns: vPaginationResult(
      v.object({
        _id: v.string(),
        name: v.string(),
      }),
    ),
  });

  // List threads for a user (query)
  const listThreads = queryGeneric({
    args: {
      apiKey: v.string(),
      userId: v.optional(v.string()),
      paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      const results = await ctx.runQuery(
        component.threads.listThreadsByUserId,
        {
          userId: args.userId,
          paginationOpts: args.paginationOpts,
          order: "desc",
        },
      );
      return {
        ...results,
        page: await Promise.all(
          results.page.map(async (thread) => {
            const {
              page: [last],
            } = await ctx.runQuery(component.messages.listMessagesByThreadId, {
              threadId: thread._id,
              order: "desc",
              paginationOpts: {
                numItems: 1,
                cursor: null,
              },
            });
            return {
              ...thread,
              lastAgentName: last?.agentName,
              latestMessage: last?.text,
              lastMessageAt: last?._creationTime,
            };
          }),
        ),
      };
    },
    returns: vPaginationResult(
      v.object({
        ...vThreadDoc.fields,
        lastAgentName: v.optional(v.string()),
        latestMessage: v.optional(v.string()),
        lastMessageAt: v.optional(v.number()),
      }),
    ),
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
      return ctx.runQuery(component.messages.listMessagesByThreadId, {
        threadId: args.threadId,
        paginationOpts: args.paginationOpts,
        order: "desc",
        statuses: ["success", "failed", "pending"],
      });
    },
    returns: vPaginationResult(vMessageDoc),
  });

  // Create a thread (mutation)
  const createThread = mutationGeneric({
    args: {
      apiKey: v.string(),
      userId: v.string(),
      title: v.optional(v.string()),
      summary: v.optional(v.string()),
      /** @deprecated Unused. */
      agentName: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
      // if (args.agentName) {
      //   console.warn(
      //     "Upgrade to the latest version of @convex-dev/agent-playground"
      //   );
      // }
      await validateApiKey(ctx, args.apiKey);
      const { _id } = await ctx.runMutation(component.threads.createThread, {
        userId: args.userId,
        title: args.title,
        summary: args.summary,
      });
      return { threadId: _id };
    },
    returns: v.object({ threadId: v.string() }),
  });

  // Send a message (action)
  const generateText = actionGeneric({
    args: {
      apiKey: v.string(),
      agentName: v.string(),
      userId: v.string(),
      threadId: v.string(),
      // Options for generateText
      contextOptions: v.optional(vContextOptions),
      storageOptions: v.optional(vStorageOptions),
      // Args passed through to generateText
      prompt: v.optional(v.string()),
      messages: v.optional(v.array(vMessage)),
      system: v.optional(v.string()),
    },
    handler: async (ctx: GenericActionCtx<DataModel>, args) => {
      const {
        apiKey,
        agentName,
        userId,
        threadId,
        contextOptions,
        storageOptions,
        system,
        ...rest
      } = args;
      await validateApiKey(ctx, apiKey);
      const agents = await getAgents(ctx, {
        userId: args.userId,
        threadId: args.threadId,
      });
      const namedAgent = agents.find(({ name }) => name === agentName);
      if (!namedAgent) throw new Error(`Unknown agent: ${agentName}`);
      const { agent } = namedAgent;
      const { thread } = await agent.continueThread(ctx, { threadId, userId });
      const { messageId, text } = await thread.generateText(
        { ...rest, ...(system ? { system } : {}) },
        {
          contextOptions,
          storageOptions,
        },
      );
      return { messageId, text };
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
      const agents = await getAgents(ctx, {
        userId: args.userId,
        threadId: args.threadId,
      });
      const namedAgent = agents.find(({ name }) => name === args.agentName);
      if (!namedAgent) throw new Error(`Unknown agent: ${args.agentName}`);
      const { agent } = namedAgent;
      const contextOptions = args.contextOptions;
      if (args.beforeMessageId) {
        contextOptions.recentMessages =
          (contextOptions.recentMessages ?? 10) + 1;
      }
      const messages = await agent.fetchContextMessages(ctx, {
        userId: args.userId,
        threadId: args.threadId,
        messages: args.messages,
        contextOptions: args.contextOptions,
        upToAndIncludingMessageId: args.beforeMessageId,
      });
      return messages.filter(
        (m) => !args.beforeMessageId || m._id !== args.beforeMessageId,
      );
    },
  });

  return {
    isApiKeyValid,
    listUsers,
    listThreads,
    listMessages,
    listAgents,
    createThread,
    generateText,
    fetchPromptContext,
  };
}

type RunQueryCtx = { runQuery: GenericQueryCtx<GenericDataModel>["runQuery"] };
