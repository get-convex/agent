/**
 * This example is a bit of a work in progress, but shows how to chain together calls to agents.
 */
import { action, ActionCtx, query } from "./_generated/server";
import { api, components } from "./_generated/api";
import { Agent } from "@convex-dev/agent";
import { v } from "convex/values";
import { openai } from "@ai-sdk/openai";

import { createTool } from "@convex-dev/agent";
import { Id } from "./_generated/dataModel";
import type { MessageDoc } from "@convex-dev/agent";
import { z } from "zod";
import { zid } from "convex-helpers/server/zod";
/**
 * TOOLS
 */
type Idea = {
  title: string;
  summary: string;
  tags: string[];
  ideaId: Id<"ideas">;
  createdAt: string;
  lastUpdated: string;
};

export const ideaSearch = createTool({
  description: "Search for ideas by space-delimited keywords",
  args: z.object({ query: z.string() }),
  handler: async (ctx, { query }): Promise<Array<Idea>> => {
    console.log("searching for ideas", query);
    const ideas = await ctx.runQuery(api.ideas.searchIdeas, { query });
    console.log("found ideas", ideas);
    return ideas;
  },
});

export const ideaCreation = createTool({
  description:
    "Create a new idea with an initial entryId. " +
    "You can pass in the entryId of what inspired the idea.",
  args: z.object({
    title: z.string(),
    summary: z.string(),
    tags: z.array(z.string()),
    entryId: z.union([zid("entries"), z.null()]),
  }),
  handler: async (ctx, args): Promise<Id<"ideas">> => {
    console.log("creating idea", args);
    return ctx.runMutation(api.ideas.createIdea, args);
  },
});

export const ideaUpdate = createTool({
  description:
    "Update an idea identified by ideaId to include an entryId, and update the title, summary, and tags accordingly",
  args: z.object({
    ideaId: zid("ideas"),
    title: z.union([z.string(), z.null()]),
    summary: z.union([z.string(), z.null()]),
    tags: z.union([z.array(z.string()), z.null()]),
    entryId: zid("entries"),
  }),
  handler: async (ctx, args) => {
    console.log("updating idea", args);
    await ctx.runMutation(api.ideas.updateIdea, args);
  },
});

export const ideaMerge = createTool({
  description:
    "Merge two ideas, deleting the source and adding its entries to the target",
  args: z.object({
    sourceIdeaId: zid("ideas"),
    targetIdeaId: zid("ideas"),
    newTargetTitle: z.string(),
    newTargetSummary: z.string(),
  }),
  handler: (ctx, args): Promise<null> => {
    console.log("merging ideas", args);
    return ctx.runMutation(api.ideas.mergeIdeas, args);
  },
});

export const attachEntryToIdea = createTool({
  description: "Combine an entry into an existing idea",
  args: z.object({
    ideaId: zid("ideas"),
    entryId: zid("entries"),
  }),
  handler: (ctx, args): Promise<null> => {
    console.log("attaching entry to idea", args);
    return ctx.runMutation(api.ideas.attachEntryToIdea, args);
  },
});

/**
 * AGENTS
 */

const ideaManagerAgent = new Agent(components.agent, {
  name: "Idea Manager Agent",
  chat: openai.chat("gpt-4o"), // Fancier model for discerning between ideas
  textEmbedding: openai.embedding("text-embedding-3-small"),
  instructions:
    "You are a helpful assistant that helps manage ideas identified by ideaId. " +
    "You can search, create, and merge ideas. " +
    "You can search for existing ideas by space-delimited keywords. " +
    "Over time you should take feedback on how to categorize and merge ideas. " +
    "Be willing to undo mistakes and get better. When in doubt, merge ideas. " +
    "When passing IDs, you MUST pass a real ID verbatim. " +
    "entryId is for random thoughts, and ideaId is for ideas which have associated entryIds. " +
    "If you don't have one, search for one first.",
  tools: { ideaCreation, ideaUpdate, ideaMerge, ideaSearch },
  contextOptions: {
    recentMessages: 20,
    searchOtherThreads: true,
    includeToolCalls: true,
  },
  maxSteps: 10,
});

const ideaDevelopmentAgent = new Agent(components.agent, {
  name: "Idea Development Agent",
  chat: openai.chat("gpt-4o-mini"),
  textEmbedding: openai.embedding("text-embedding-3-small"),
  instructions:
    "You are a helpful assistant that helps develop ideas. " +
    "You can add to and reorganize the summary of existing ideas. " +
    "Over time you should take feedback on how to organize ideas. " +
    "Be willing to undo mistakes and get better." +
    "You MUST pass the ID verbatim to the updateIdea tool. ",
  tools: { ideaUpdate },
  contextOptions: {
    recentMessages: 5,
    searchOtherThreads: false,
    searchOptions: {
      limit: 10,
      textSearch: true,
      vectorSearch: true,
    },
  },
  maxSteps: 10,
});

/**
 * USING AGENTS TOGETHER
 */

export const submitRandomThought = action({
  args: {
    userId: v.string(), // in practice you'd use the authenticated user's ID
    entry: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    // Get or create a thread
    const { thread } = await getOrCreateManagerThread(ctx, args.userId);

    const entryId = await ctx.runMutation(api.ideas.createEntry, {
      content: args.entry,
      ideaId: null,
    });
    console.log("entryId", entryId);

    try {
      const result = await thread.generateText({
        prompt: `
      I'm just had a random thought: ${args.entry}.
      The entryId for this is ${entryId}.
      Please help me organize it with existing ideas.
      `,
      });
      console.log("result", result.text);
      return result.text;
    } catch (e) {
      console.error("error while organizing thought", e);
      return "Error: " + (e as Error).message;
    }
    // const result = await thread.generateObject({
    //   prompt: `
    //   I'm just had a random thought: ${args.entry}.
    //   The entryId for this is ${entryId}.
    //   Please help me organize it with existing ideas.
    //   `,
    //   schema: z.object({
    //     ideaId: v.id("ideas").describe("The ID of the idea that exists or was updated"),
    //   }),
    // });
    // const { thread: developerThread } = await ideaDevelopmentAgent.continueThread(ctx, {
    //   threadId: thread.threadId,
    //   userId: args.userId,
    // });

    // const developerResult = await developerThread.generateText({
    //   prompt: `
    //   Please help me develop this idea.
    //   `,
    // });
    // return developerResult.text;
  },
});

async function getOrCreateManagerThread(ctx: ActionCtx, userId: string) {
  const { page } = await ctx.runQuery(
    components.agent.threads.getThreadsByUserId,
    { userId, paginationOpts: { numItems: 1, cursor: null } },
  );
  const threadId = page[0]?._id;
  if (threadId) {
    const { thread } = await ideaManagerAgent.continueThread(ctx, {
      threadId,
      userId,
    });
    return { thread, threadId };
  }
  return await ideaManagerAgent.createThread(ctx, { userId });
}

/**
 * AGENTS AS TOOLS TO OTHER AGENTS
 * Note: This isn't working well yet.
 */

// const ideaManager = ideaManagerAgent.asTool({
//   description:
//     "Call on me to organize and create ideas. " +
//     "Tell me the what you need, and I'll tell you what I did. " +
//     "If you want me to do something with a specific existing idea, " +
//     "tell me the ID of the idea verbatim.",
//   args: v.object({
//     id: v.optional(v.id("ideas")),
//     command: v.string(),
//   }),
//   maxSteps: 10,
// });

// const ideaDeveloper = ideaDevelopmentAgent.asTool({
//   description:
//     "Call on me to develop ideas. " +
//     "Tell me what the idea's ID is, and I'll tell you what I did. " +
//     "The ID should be from a real existing idea, not fabricated.",
//   args: v.object({
//     id: v.id("ideas"),
//     command: v.string(),
//   }),
//   maxSteps: 5,
// });

/**
 * AGENT DISPATCHERS
 */

// const ideaTriageAgent = new Agent(components.agent, {
//   name: "Idea Triage Agent",
//   chat: openai.chat("gpt-4o-mini"),
//   textEmbedding: openai.embedding("text-embedding-3-small"),
//   instructions:
//     "You are a helpful assistant that helps triage ideas. " +
//     "You should delegate to the manager or developer agents to help you. " +
//     "You can search for existing ideas to help triage. " +
//     "If you are given an entryId, that is different from an ideaId, " +
//     "you should delegate to the ideaManager to create an idea from the entry. " +
//     "Be willing to undo mistakes and get better.",
//   tools: { ideaSearch, ideaManager, ideaDeveloper },
//   contextOptions: {
//     recentMessages: 5,
//     searchOtherThreads: false,
//   },
//   maxSteps: 20,
// });

export const inProgressMessages = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<Array<MessageDoc>> => {
    const { page } = await ctx.runQuery(
      components.agent.threads.getThreadsByUserId,
      { userId },
    );
    const threadId = page[0]?._id;
    if (!threadId) {
      return [];
    }
    const messages = await ctx.runQuery(
      components.agent.messages.getThreadMessages,
      { threadId, statuses: ["pending"] },
    );
    return messages.page;
  },
});
