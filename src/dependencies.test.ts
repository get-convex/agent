import { readdir, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const root = new URL("../", import.meta.url);

// Workflow support is duck-typed on `workflowId`, so installs must not require
// @convex-dev/workflow: npm auto-installs required peers, and users on another
// workflow minor would hit ERESOLVE.
describe("@convex-dev/workflow is not a dependency", () => {
  test("package.json does not require it", async () => {
    const pkg = JSON.parse(
      await readFile(new URL("package.json", root), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    expect(Object.keys(pkg.peerDependencies ?? {})).not.toContain(
      "@convex-dev/workflow",
    );
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain(
      "@convex-dev/workflow",
    );
  });

  test("published source does not import it", async () => {
    const files = await readdir(new URL("src/", root), { recursive: true });
    const importers: string[] = [];
    for (const file of files) {
      if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      const source = await readFile(new URL(`src/${file}`, root), "utf8");
      if (source.includes('"@convex-dev/workflow"')) importers.push(file);
    }
    expect(importers).toEqual([]);
  });
});
