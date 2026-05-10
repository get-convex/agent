/// <reference types="vite/client" />
import { test } from "vitest";
import { convexTest, type TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./schema.js";
import agent from "@convex-dev/agent/test";
import workflow from "@convex-dev/workflow/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
export const modules = import.meta.glob("./**/*.*s");

export function initConvexTest() {
  const t = convexTest(schema, modules);
  agent.register(t);
  workflow.register(t);
  // @convex-dev/rate-limiter@0.3.2 still ships a non-generic register
  // signature (`TestConvex<SchemaDefinition<GenericSchema, boolean>>`),
  // and TestConvex is invariant in its schema param, so a specifically-
  // typed `t` does not satisfy it. Drop this cast once rate-limiter
  // ships a generic register (tracked upstream).
  rateLimiter.register(
    t as unknown as TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  );
  return t;
}

test("setup", () => {});
