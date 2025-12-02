import { expect, test } from "vitest";
import { components } from "./_generated/api.js";
import { createThread } from "@convex-dev/agent";
import { initConvexTest } from "./setup.test.js";

test("Agent createThread", async () => {
  const t = initConvexTest();

  const threadId = await t.run(async (ctx) => {
    return await createThread(ctx, components.agent, {
      title: "Hello, world!",
    });
  });
  const thread = await t.query(components.agent.threads.getThread, {
    threadId,
  });
  expect(thread).toMatchObject({
    title: "Hello, world!",
  });
});
