/// <reference types="vite/client" />
import { test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import agent from "@convex-dev/agent/test";
export const modules = import.meta.glob("./**/*.*s");

// Sorry about everything
import rateLimiterSchema from "../../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/*.ts",
);

export function initConvexTest() {
  const t = convexTest(schema, modules);
  t.registerComponent("agent", agent.schema, agent.modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

test("setup", () => {});
