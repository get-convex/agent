// See the docs at https://docs.convex.dev/agents/tools
import { components } from "../_generated/api";
import {
  Agent,
  createThread,
  createTool,
  stepCountIs,
} from "@convex-dev/agent";
import z from "zod/v3";
import { action } from "../_generated/server";
import { tool } from "ai";
import { defaultConfig } from "../agents/config";

export const runAgentAsTool = action({
  args: {},
  handler: async (ctx) => {
    const agentWithTools = new Agent(components.agent, {
      name: "agentWithTools",
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
      ...defaultConfig,
    });
    const agentWithToolsAsTool = createTool({
      description:
        "agentWithTools which can either doSomething or doSomethingElse",
      inputSchema: z.object({
        whatToDo: z.union([
          z.literal("doSomething"),
          z.literal("doSomethingElse"),
        ]),
      }),
      execute: async (ctx, input) => {
        // Create a nested thread to call the agent with tools
        const threadId = await createThread(ctx, components.agent, {
          userId: ctx.userId,
        });
        const result = await agentWithTools.generateText(
          ctx,
          { threadId },
          {
            messages: [
              {
                role: "assistant",
                content: `I'll do this now: ${input.whatToDo}`,
              },
            ],
          },
        );
        return result.text;
      },
    });
    const dispatchAgent = new Agent(components.agent, {
      name: "dispatchAgent",
      instructions:
        "You can call agentWithToolsAsTool as many times as told with the argument whatToDo.",
      tools: { agentWithToolsAsTool },
      stopWhen: stepCountIs(5),
      ...defaultConfig,
    });

    const threadId = await createThread(ctx, components.agent);
    console.time("overall");
    const result = await dispatchAgent.generateText(
      ctx,
      { threadId },
      {
        messages: [
          {
            role: "user",
            content:
              "Call fastAgent with whatToDo set to doSomething three times and doSomethingElse one time",
          },
        ],
      },
    );
    console.timeEnd("overall");
    return result.text;
  },
});
