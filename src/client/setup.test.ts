/// <reference types="vite/client" />
import { test } from "vitest";
import { convexTest } from "convex-test";
export const modules = import.meta.glob("./**/*.*s");

import {
  defineSchema,
  type GenericSchema,
  type SchemaDefinition,
} from "convex/server";
import { type AgentComponent } from "./index.js";
import { componentsGeneric } from "convex/server";
import component from "../test.js";

export function initConvexTest<
  Schema extends SchemaDefinition<GenericSchema, boolean>,
>(schema?: Schema) {
  const t = convexTest((schema ?? defineSchema({})) as Schema, modules);
  component.register(t);
  return t;
}
export const components = componentsGeneric() as unknown as {
  agent: AgentComponent;
};

test("setup", () => {});
