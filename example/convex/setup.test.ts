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
  // workflow and rate-limiter still type their `register` against the
  // pre-generic SchemaDefinition<GenericSchema, boolean>. Cast through
  // the broader type so this file typechecks regardless of which version
  // of those packages is resolved.
  const generic = t as unknown as TestConvex<
    SchemaDefinition<GenericSchema, boolean>
  >;
  workflow.register(generic);
  rateLimiter.register(generic);
  return t;
}

test("setup", () => {});
