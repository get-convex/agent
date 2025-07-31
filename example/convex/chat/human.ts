// See the docs at https://docs.convex.dev/agents/human-agents
import {
  saveMessage,
  listMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { paginationOptsValidator } from "convex/server";
import { authorizeThreadAccess } from "../threads";
import { z } from "zod";
import { createTool } from "@convex-dev/agent";
import { agent } from "../agents/simple";

/**
 * ===============================
 * OPTION 1: Sending messages as an "assistant" role
 * ===============================
 */

/**
 * Sending a message from a human agent.
 * This does not kick off an LLM response.
 * This is an internal mutation that can be called from other functions.
 * To have a logged in support agent send it, you could use a public mutation
 * along with auth to find the support agent's name and ensure they have access
 * to the specified thread.
 */
export const sendMessageFromHumanAgent = internalMutation({
  args: { agentName: v.string(), message: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      agentName: args.agentName,
      message: {
        role: "assistant",
        content: args.message,
      },
    });
    return messageId;
  },
});

/**
 * Sending a message from a user
 */
export const sendMessageFromUser = mutation({
  args: { message: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId);
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      // prompt is shorthand for message: { role: "user", content: prompt }
      prompt: args.message,
    });
  },
});

/**
 * ===============================
 * OPTION 2: Sending messages as a tool call
 * ===============================
 */

export const askHuman = createTool({
  description: "Ask a human a question",
  args: z.object({
    question: z.string().describe("The question to ask the human"),
  }),
  handler: async (ctx, { question }) => {
    return question;
  },
});

export const ask = action({
  args: { question: v.string(), threadId: v.string() },
  handler: async (ctx, { question, threadId }) => {
    const result = await agent.generateText(
      ctx,
      { threadId },
      {
        prompt: question,
        tools: { askHuman },
      },
    );
    const supportRequests = result.toolCalls
      .filter((tc) => tc.toolName === "askHuman")
      .map((tc) => ({
        toolCallId: tc.toolCallId,
        question: (tc.input as { question: string }).question,
      }));
    if (supportRequests.length > 0) {
      // Do something so the support agent knows they need to respond,
      // e.g. save a message to their inbox
      // await ctx.runMutation(internal.example.sendToSupport, {
      //   threadId,
      //   supportRequests,
      // });
    }
    return {
      response: result.text,
      supportRequests,
      messageId: result.messageId,
    };
  },
});

export const humanResponseAsToolCall = internalAction({
  args: {
    humanName: v.string(),
    response: v.string(),
    toolCallId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    await agent.saveMessage(ctx, {
      threadId: args.threadId,
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            output: args.response as any,
            toolCallId: args.toolCallId,
            toolName: "askHuman",
          },
        ],
      },
      metadata: {
        provider: "human",
        providerMetadata: {
          human: { name: args.humanName },
        },
      },
    });
    // Continue generating a response from the LLM
    await agent.generateText(
      ctx,
      { threadId: args.threadId },
      { promptMessageId: args.messageId },
    );
  },
});

/**
 * ===============================
 * Other things
 * ===============================
 */

/**
 * Listing messages without using an agent
 */

export const getMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const messages = await listMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    return { ...messages, streams };
  },
});
