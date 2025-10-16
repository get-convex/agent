/// <reference types="vite/client" />
import { test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import agent from "@convex-dev/agent/test";
import workflow from "@convex-dev/workflow/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
export const modules = import.meta.glob("./**/*.*s");

export function initConvexTest() {
  const t = convexTest(schema, modules);
  agent.register(t);
  workflow.register(t);
  rateLimiter.register(t);
  return t;
}

test("setup", () => {});
