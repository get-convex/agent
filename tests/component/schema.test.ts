import { expect, test } from "vitest";
import schema from "../../src/component/schema.js";

test("core schema only installs Agent-owned tables", () => {
  expect(schema.tables).not.toHaveProperty("memories");
  expect(schema.tables).not.toHaveProperty("apiKeys");
  expect(schema.tables).not.toHaveProperty("files");
  expect(schema.tables).toHaveProperty("runToolCalls");
  expect(schema.tables.messages.validator.fields).not.toHaveProperty("fileIds");
  expect(schema.tables.runs.validator.fields).not.toHaveProperty("toolCalls");
  for (const tableName of Object.keys(schema.tables)) {
    expect(tableName.startsWith("embeddings_")).toBe(false);
  }
});
