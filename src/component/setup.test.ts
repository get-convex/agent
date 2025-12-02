/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { test } from "vitest";
import schema from "./schema.js";
export const modules = import.meta.glob("./**/*.*s");

export function initConvexTest() {
  const t = convexTest(schema, modules);
  return t;
}

test("setup", () => {});
