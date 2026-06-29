/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { streamTest } from "@convex-dev/stream/test";
import schema from "../../src/component/schema.js";
export const modules = import.meta.glob("../../src/component/**/*.*s");

export function initConvexTest() {
  const t = convexTest(schema, modules);
  streamTest.use(t, { name: "stream" });
  streamTest.use(t, { name: "agent/stream" });
  return t;
}
