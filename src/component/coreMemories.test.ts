/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";

describe("coreMemories", () => {
  test("create, get and update fields", async () => {
    const t = convexTest(schema, modules);

    const id = await t.mutation(api.coreMemories.create, {
      userId: "u1",
      persona: "p1",
      human: "h1",
    });

    const got = await t.query(api.coreMemories.get, { userId: "u1" });
    expect(got?._id).toBe(id);
    expect(got?.persona).toBe("p1");
    expect(got?.human).toBe("h1");

    await t.mutation(api.coreMemories.update, {
      userId: "u1",
      persona: "p2",
    });

    const after = await t.query(api.coreMemories.get, { userId: "u1" });
    expect(after?.persona).toBe("p2");
    expect(after?.human).toBe("h1");
  });

  test("update supports null to unset fields", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.coreMemories.create, {
      userId: "u2",
      persona: "p1",
      human: "h1",
    });

    await t.mutation(api.coreMemories.update, {
      userId: "u2",
      persona: null,
    });

    const got = await t.query(api.coreMemories.get, { userId: "u2" });
    expect(got?.persona).toBeUndefined();
    expect(got?.human).toBe("h1");
  });

  test("append and prepend modify specified field", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.coreMemories.create, { userId: "u3" });

    await t.mutation(api.coreMemories.append, {
      userId: "u3",
      field: "persona",
      text: "A",
    });
    await t.mutation(api.coreMemories.append, {
      userId: "u3",
      field: "persona",
      text: "B",
    });
    let got = await t.query(api.coreMemories.get, { userId: "u3" });
    expect(got?._id).toBe(id as Id<"coreMemories">);
    expect(got?.persona).toBe("AB");

    await t.mutation(api.coreMemories.prepend, {
      userId: "u3",
      field: "persona",
      text: "Z",
    });
    got = await t.query(api.coreMemories.get, { userId: "u3" });
    expect(got?.persona).toBe("ZAB");
  });

  test("insert and remove operate by index and length bounds", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.coreMemories.create, {
      userId: "u4",
      human: "hello",
    });

    // insert at index 2
    await t.mutation(api.coreMemories.insert, {
      userId: "u4",
      field: "human",
      index: 2,
      text: "-X-",
    });
    let got = await t.query(api.coreMemories.get, { userId: "u4" });
    expect(got?.human).toBe("he-X-llo");

    // remove the inserted segment
    await t.mutation(api.coreMemories.remove, {
      userId: "u4",
      field: "human",
      index: 2,
      length: 3,
    });
    got = await t.query(api.coreMemories.get, { userId: "u4" });
    expect(got?.human).toBe("hello");
  });

  test("create prevents duplicates per userId", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.coreMemories.create, { userId: "u5" });
    const again = await t.mutation(api.coreMemories.create, { userId: "u5" });
    // Should keep the same document (get returns the existing one)
    const got = await t.query(api.coreMemories.get, { userId: "u5" });
    expect(got?._id).toBe(id);
    expect(again).toBe(id);
  });
});
