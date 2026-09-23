import { describe, expect, test } from "vitest";
import { anyApi, defineSchema, type ApiFromModules } from "convex/server";
import {
  Agent,
  definePlaygroundAPI,
  definePlaygroundActions,
  definePlaygroundQueries,
  type PlaygroundAgentInfo,
} from "../index.js";
import { components, initConvexTest } from "./setup.test.js";
import { mockModel } from "./mockModel.js";

const schema = defineSchema({});

const info: PlaygroundAgentInfo = {
  name: "node-agent",
  instructions: "Runs in Node.",
  contextOptions: { recentMessages: 5 },
  tools: ["fetchThing"],
};
const agent = new Agent(components.agent, {
  name: info.name,
  instructions: "Runs anywhere.",
  languageModel: mockModel({
    content: [{ type: "text", text: "hello from the split" }],
  }),
});
export const { listAgents: listAgentsFromInfos, createThread } =
  definePlaygroundQueries(components.agent, {
    agents: [info, { name: "bare" }],
  });
export const { generateText: generateTextSplit } = definePlaygroundActions(
  components.agent,
  { agents: [agent] },
);
export const { listAgents: listAgentsCombined } = definePlaygroundAPI(
  components.agent,
  { agents: () => [agent] },
);

const api = anyApi["definePlaygroundAPI.test"] as unknown as ApiFromModules<{
  m: {
    listAgentsFromInfos: typeof listAgentsFromInfos;
    listAgentsCombined: typeof listAgentsCombined;
    generateTextSplit: typeof generateTextSplit;
    createThread: typeof createThread;
  };
}>["m"];

describe("split playground API", () => {
  test("queries list agents from metadata alone, in the shape the playground expects", async () => {
    const t = initConvexTest(schema);
    const apiKey = await t.mutation(components.agent.apiKeys.issue, {});
    expect(await t.query(api.listAgentsFromInfos, { apiKey })).toStrictEqual([
      info,
      { name: "bare", tools: [] },
    ]);
  });

  test("actions defined on their own run the agent", async () => {
    const t = initConvexTest(schema);
    const apiKey = await t.mutation(components.agent.apiKeys.issue, {});
    const [{ name: agentName }] = await t.query(api.listAgentsFromInfos, {
      apiKey,
    });
    const { threadId } = await t.mutation(api.createThread, {
      apiKey,
      userId: "u",
    });
    const result = await t.action(api.generateTextSplit, {
      apiKey,
      agentName,
      userId: "u",
      threadId,
      prompt: "hi",
    });
    expect(result.text).toBe("hello from the split");
  });

  test("combined API lists agent instances from a callback", async () => {
    const t = initConvexTest(schema);
    const apiKey = await t.mutation(components.agent.apiKeys.issue, {});
    expect(await t.query(api.listAgentsCombined, { apiKey })).toMatchObject([
      { name: info.name, tools: [] },
    ]);
    await t.mutation(components.agent.apiKeys.destroy, { apiKey });
    await expect(t.query(api.listAgentsCombined, { apiKey })).rejects.toThrow();
  });
});
