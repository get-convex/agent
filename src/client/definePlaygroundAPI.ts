import {
  actionGeneric,
  mutationGeneric,
  paginationOptsValidator,
  queryGeneric,
  type ApiFromModules,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericQueryCtx,
} from "convex/server";
import { v } from "convex/values";
import {
  createThread as createThread_,
  listMessages as listMessages_,
  toModelMessage,
  vContextOptions,
  vMessage,
  vMessageDoc,
  vPaginationResult,
  vStorageOptions,
  vThreadDoc,
  type Agent,
  type AgentComponent,
  vStreamArgs,
  syncStreams,
  vStreamMessagesReturnValue,
  isTool,
  extractText,
  type MessageDoc,
} from "./index.js";
import { serializeNewMessagesInStep } from "../mapping.js";
import { getModelName, getProviderName } from "../shared.js";

export type PlaygroundAPI = ApiFromModules<{
  playground: ReturnType<typeof definePlaygroundAPI>;
}>["playground"];

export type PlaygroundQueriesAPI = ApiFromModules<{
  playground: ReturnType<typeof definePlaygroundQueries>;
}>["playground"];

export type PlaygroundActionsAPI = ApiFromModules<{
  playground: ReturnType<typeof definePlaygroundActions>;
}>["playground"];

export type AgentsFn<DataModel extends GenericDataModel> = (
  ctx: GenericActionCtx<DataModel> | GenericQueryCtx<DataModel>,
  args: { userId: string | undefined; threadId: string | undefined },
) => Agent[] | Promise<Agent[]>;

/**
 * Configuration for agent info displayed in queries when the actual Agent
 * instance cannot be accessed (due to V8/Node.js runtime separation).
 */
export type AgentInfo = {
  name: string;
  instructions?: string;
  contextOptions?: unknown;
  storageOptions?: unknown;
  maxRetries?: number;
  tools?: string[];
};

type RunQueryCtx = { runQuery: GenericQueryCtx<GenericDataModel>["runQuery"] };

/**
 * Defines the V8-safe queries and mutations for the playground API.
 * 
 * Use this when you need to separate queries/mutations from actions due to
 * Node.js-only dependencies in your agent (e.g., Vertex AI, google-auth-library).
 * 
 * @example
 * ```typescript
 * // convex/playground.ts (V8 runtime - no "use node")
 * import { definePlaygroundQueries } from "@convex-dev/agent";
 * import { components } from "./_generated/api";
 * 
 * const { isApiKeyValid, listAgents, listUsers, listThreads, listMessages, createThread } = 
 *   definePlaygroundQueries(components.agent, {
 *     agents: [{ name: "MyAgent", instructions: "...", tools: ["tool1"] }],
 *   });
 * 
 * export { isApiKeyValid, listAgents, listUsers, listThreads, listMessages, createThread };
 * ```
 * 
 * @param component - The agent component reference
 * @param options - Configuration options including agent info and optional user name lookup
 * @returns Object containing V8-safe query and mutation functions
 */
export function definePlaygroundQueries<DataModel extends GenericDataModel>(
  component: AgentComponent,
  {
    agents: agentInfos,
    userNameLookup,
  }: {
    /**
     * Static agent information for display in queries.
     * Since Agent instances may require Node.js, provide static info here.
     */
    agents: AgentInfo[];
    userNameLookup?: (
      ctx: GenericQueryCtx<DataModel>,
      userId: string,
    ) => string | Promise<string>;
  },
) {
  async function validateApiKey(ctx: RunQueryCtx, apiKey: string) {
    await ctx.runQuery(component.apiKeys.validate, { apiKey });
  }

  const isApiKeyValid = queryGeneric({
    args: { apiKey: v.string() },
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

  // List all agents (static info)
  const listAgents = queryGeneric({
    args: {
      apiKey: v.string(),
      userId: v.optional(v.string()),
      threadId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      return agentInfos.map((info) => ({
        name: info.name,
        instructions: info.instructions,
        contextOptions: info.contextOptions,
        storageOptions: info.storageOptions,
        maxRetries: info.maxRetries,
        tools: info.tools ?? [],
      }));
    },
  });

  const listUsers = queryGeneric({
    args: { apiKey: v.string(), paginationOpts: paginationOptsValidator },
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
    returns: vPaginationResult(v.object({ _id: v.string(), name: v.string() })),
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
              paginationOpts: { numItems: 1, cursor: null },
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
      streamArgs: vStreamArgs,
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      const paginated = await listMessages_(ctx, component, {
        threadId: args.threadId,
        paginationOpts: args.paginationOpts,
        statuses: ["success", "failed", "pending"],
      });
      const streams = await syncStreams(ctx, component, args);

      return { ...paginated, streams };
    },
    returns: vStreamMessagesReturnValue,
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
      await validateApiKey(ctx, args.apiKey);
      const threadId = await createThread_(ctx, component, {
        userId: args.userId,
        title: args.title,
        summary: args.summary,
      });
      return { threadId };
    },
    returns: v.object({ threadId: v.string() }),
  });

  return {
    isApiKeyValid,
    listUsers,
    listThreads,
    listMessages,
    listAgents,
    createThread,
  };
}

/**
 * Defines the Node.js-only actions for the playground API.
 * 
 * Use this when you need to separate queries/mutations from actions due to
 * Node.js-only dependencies in your agent (e.g., Vertex AI, google-auth-library).
 * 
 * @example
 * ```typescript
 * // convex/playgroundActions.ts (Node.js runtime - with "use node")
 * "use node";
 * import { definePlaygroundActions } from "@convex-dev/agent";
 * import { components } from "./_generated/api";
 * import { myAgent } from "./agent";
 * 
 * const { generateText, fetchPromptContext } = definePlaygroundActions(
 *   components.agent,
 *   { agents: [myAgent] }
 * );
 * 
 * export { generateText, fetchPromptContext };
 * ```
 * 
 * @param component - The agent component reference
 * @param options - Configuration options including agent instances
 * @returns Object containing Node.js action functions
 */
export function definePlaygroundActions<DataModel extends GenericDataModel>(
  component: AgentComponent,
  {
    agents: agentsOrFn,
  }: {
    agents: Agent[] | AgentsFn<DataModel>;
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
        messages,
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
      const { text, steps } = await agent.streamText(
        ctx,
        { threadId, userId },
        {
          ...rest,
          ...(system ? { system } : {}),
          ...(messages ? { messages: messages.map(toModelMessage) } : {}),
        },
        { contextOptions, storageOptions, saveStreamDeltas: true },
      );
      const outputMessages = await Promise.all(
        (await steps).map(async (step) => {
          const { messages } = await serializeNewMessagesInStep(
            ctx,
            component,
            step,
            {
              model: getModelName(agent.options.languageModel),
              provider: getProviderName(agent.options.languageModel),
            },
          );
          return messages.map((messageWithMetadata, i) => {
            return {
              ...messageWithMetadata,
              tool: isTool(messageWithMetadata.message),
              text: extractText(messageWithMetadata.message),
              status: "success",
              providerMetadata: {},
              threadId,
              _id: crypto.randomUUID(),
              _creationTime: Date.now(),
              order: 0,
              stepOrder: i + 1,
            } satisfies MessageDoc;
          });
        }),
      );
      return { text: await text, messages: outputMessages.flat() };
    },
    returns: v.object({ text: v.string(), messages: v.array(vMessageDoc) }),
  });

  // Fetch prompt context (action)
  const fetchPromptContext = actionGeneric({
    args: {
      apiKey: v.string(),
      agentName: v.string(),
      userId: v.optional(v.string()),
      threadId: v.optional(v.string()),
      searchText: v.optional(v.string()),
      targetMessageId: v.optional(v.string()),
      contextOptions: vContextOptions,
      // @deprecated use searchText and targetMessageId instead
      messages: v.optional(v.array(vMessage)),
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
      const targetMessageId = args.targetMessageId ?? args.beforeMessageId;
      if (targetMessageId) {
        contextOptions.recentMessages =
          (contextOptions.recentMessages ?? 10) + 1;
      }
      const messages = await agent.fetchContextMessages(ctx, {
        userId: args.userId,
        threadId: args.threadId,
        targetMessageId,
        searchText: args.searchText,
        contextOptions: args.contextOptions,
        messages: args.messages?.map(toModelMessage),
      });
      const targetMessageIndex = messages.findIndex(
        (m) => m._id === targetMessageId,
      );
      if (targetMessageIndex !== -1) {
        return messages.slice(0, targetMessageIndex);
      }
      return messages;
    },
  });

  return {
    generateText,
    fetchPromptContext,
  };
}

/**
 * Defines the complete playground API (queries, mutations, and actions).
 * 
 * **Important:** This combined API only works when your agents don't require
 * Node.js-only dependencies. If you're using providers like Vertex AI that
 * require Node.js modules (http, https, google-auth-library), use the split
 * APIs instead:
 * - {@link definePlaygroundQueries} for V8-safe queries/mutations
 * - {@link definePlaygroundActions} for Node.js actions
 * 
 * @example
 * ```typescript
 * // convex/playground.ts - works with OpenAI (fetch-based)
 * import { definePlaygroundAPI } from "@convex-dev/agent";
 * import { components } from "./_generated/api";
 * import { myAgent } from "./agent";
 * 
 * export const {
 *   isApiKeyValid,
 *   listAgents,
 *   listUsers,
 *   listThreads,
 *   listMessages,
 *   createThread,
 *   generateText,
 *   fetchPromptContext,
 * } = definePlaygroundAPI(components.agent, { agents: [myAgent] });
 * ```
 * 
 * @param component - The agent component reference
 * @param options - Configuration options including agents and optional user name lookup
 * @returns Object containing all playground API functions
 */
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
    args: { apiKey: v.string() },
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
        maxRetries: agent.options.callSettings?.maxRetries,
        tools: agent.options.tools ? Object.keys(agent.options.tools) : [],
      }));
    },
  });

  const listUsers = queryGeneric({
    args: { apiKey: v.string(), paginationOpts: paginationOptsValidator },
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
    returns: vPaginationResult(v.object({ _id: v.string(), name: v.string() })),
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
              paginationOpts: { numItems: 1, cursor: null },
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
      streamArgs: vStreamArgs,
    },
    handler: async (ctx, args) => {
      await validateApiKey(ctx, args.apiKey);
      const paginated = await listMessages_(ctx, component, {
        threadId: args.threadId,
        paginationOpts: args.paginationOpts,
        statuses: ["success", "failed", "pending"],
      });
      const streams = await syncStreams(ctx, component, args);

      return { ...paginated, streams };
    },
    returns: vStreamMessagesReturnValue,
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
      await validateApiKey(ctx, args.apiKey);
      const threadId = await createThread_(ctx, component, {
        userId: args.userId,
        title: args.title,
        summary: args.summary,
      });
      return { threadId };
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
        messages,
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
      const { text, steps } = await agent.streamText(
        ctx,
        { threadId, userId },
        {
          ...rest,
          ...(system ? { system } : {}),
          ...(messages ? { messages: messages.map(toModelMessage) } : {}),
        },
        { contextOptions, storageOptions, saveStreamDeltas: true },
      );
      const outputMessages = await Promise.all(
        (await steps).map(async (step) => {
          const { messages } = await serializeNewMessagesInStep(
            ctx,
            component,
            step,
            {
              model: getModelName(agent.options.languageModel),
              provider: getProviderName(agent.options.languageModel),
            },
          );
          return messages.map((messageWithMetadata, i) => {
            return {
              ...messageWithMetadata,
              tool: isTool(messageWithMetadata.message),
              text: extractText(messageWithMetadata.message),
              status: "success",
              providerMetadata: {},
              threadId,
              _id: crypto.randomUUID(),
              _creationTime: Date.now(),
              order: 0,
              stepOrder: i + 1,
            } satisfies MessageDoc;
          });
        }),
      );
      return { text: await text, messages: outputMessages.flat() };
    },
    returns: v.object({ text: v.string(), messages: v.array(vMessageDoc) }),
  });

  // Fetch prompt context (action)
  const fetchPromptContext = actionGeneric({
    args: {
      apiKey: v.string(),
      agentName: v.string(),
      userId: v.optional(v.string()),
      threadId: v.optional(v.string()),
      searchText: v.optional(v.string()),
      targetMessageId: v.optional(v.string()),
      contextOptions: vContextOptions,
      // @deprecated use searchText and targetMessageId instead
      messages: v.optional(v.array(vMessage)),
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
      const targetMessageId = args.targetMessageId ?? args.beforeMessageId;
      if (targetMessageId) {
        contextOptions.recentMessages =
          (contextOptions.recentMessages ?? 10) + 1;
      }
      const messages = await agent.fetchContextMessages(ctx, {
        userId: args.userId,
        threadId: args.threadId,
        targetMessageId,
        searchText: args.searchText,
        contextOptions: args.contextOptions,
        messages: args.messages?.map(toModelMessage),
      });
      const targetMessageIndex = messages.findIndex(
        (m) => m._id === targetMessageId,
      );
      if (targetMessageIndex !== -1) {
        return messages.slice(0, targetMessageIndex);
      }
      return messages;
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
