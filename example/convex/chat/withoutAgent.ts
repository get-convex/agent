import { components, internal } from "../_generated/api";
import { internalAction, mutation } from "../_generated/server";
import { saveMessage, startGeneration } from "@convex-dev/agent";
import { v } from "convex/values";
import { authorizeThreadAccess } from "../threads";
import { generateText } from "ai";
import { getWeather } from "../tools/weather";
import { defaultConfig } from "../agents/config";

export const generateAsync = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const generation = await startGeneration(
      ctx,
      components.agent,
      // Here you pass in arguments you'll pass to the AI SDK function, so it
      // can detect and overwrite certain fields. E.g. it will turn a combo
      // of prompt, promptMessageId, and messages into a single set of messages
      // as the prompt for the LLM.
      {
        promptMessageId,
        // prompt, // Alternative to promptMessageId to use as context.
        // messages, // Another prompt alternative.
        // See https://docs.convex.dev/agents/context

        // For any `createTool`-based tools, it injects the ctx args.
        tools: { getWeather },

        // These are other AI SDK arguments worth passing through:

        // _internal, // Adds a generateId function with the pending message ID
        // abortSignal, // Listens for abort signals to track failure.
        // stopWhen, // So it can create pending messages for each step.

        // ... any extra arguments you pass through here will get returned in
        // generation.args, and the types will flow through too.
      },
      {
        agentName: "My Agent",
        threadId,
        ...defaultConfig, // the same Config you'd use for the Agent.
      },
    );

    try {
      const result = await generateText({
        ...generation.args, // This passes through
        // If you want to update the model:
        // prepareStep: async (options) => {
        //   generation.updateModel(model);
        //   return { model };
        // },
        onStepFinish: async (step) => {
          // determine if you're going to keep generating, e.g. by calling
          // your stopWhen function(s) with the steps so far.
          const createPendingMessage = false;
          await generation.save({ step }, createPendingMessage);
        },
      });
      // const savedMessages = generation.getSavedMessages();
      // Do whatever you want with the result.
      return result.text;
    } catch (error) {
      await generation.fail(String(error));
      throw error;
    }
  },
});

// Same as streaming with an Agent.
export const initiateGeneration = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt,
    });
    await ctx.scheduler.runAfter(0, internal.chat.withoutAgent.generateAsync, {
      threadId,
      promptMessageId: messageId,
    });
  },
});
