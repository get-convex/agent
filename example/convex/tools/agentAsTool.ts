// See the docs at https://docs.convex.dev/agents/tools
import { components } from "../_generated/api";
import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import z from "zod";
import { action } from "../_generated/server";
import { tool } from "ai";

export const runAgentAsTool = action({
  args: {},
  handler: async (ctx) => {
    const agentWithTools = new Agent(components.agent, {
      chat: openai.languageModel("gpt-4o-mini") as any,
      textEmbedding: openai.embedding("text-embedding-3-small"),
      instructions: "You are a helpful assistant.",
      tools: {
        doSomething: tool({
          description: "Call this function when asked to do something",
          inputSchema: z.object({}),
          execute: async (args, options) => {
            console.log("doingSomething", options.toolCallId);
            return "hello";
          },
        }),
        doSomethingElse: tool({
          description: "Call this function when asked to do something else",
          inputSchema: z.object({}),
          execute: async (args, options) => {
            console.log("doSomethingElse", options.toolCallId);
            return "hello";
          },
        }),
      },
      stopWhen: stepCountIs(20),
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
      chat: openai.languageModel("gpt-4o-mini") as any,
      textEmbedding: openai.embedding("text-embedding-3-small"),
      instructions:
        "You can call agentWithToolsAsTool as many times as told with the argument whatToDo.",
      tools: { agentWithToolsAsTool },
      stopWhen: stepCountIs(5),
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
