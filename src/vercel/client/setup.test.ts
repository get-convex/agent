import { test } from "vitest";
import { defineTestApp } from "convex-test";
import { defineSchema } from "convex/server";
import componentTest from "../../test.js";

/**
 * A test app with the agent component registered as `agent`.
 * Tests that need their own functions can call `app.defineModules`.
 */
export const app = defineTestApp({
  schema: defineSchema({}),
  components: { agent: componentTest },
});
export const components = app.components;

/** Create a fresh test instance with no app functions defined. */
export const initConvexTest = app.defineModules({}).createTest;

test("setup", () => {});
