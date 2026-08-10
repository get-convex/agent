import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

describe("provider adapter boundary lint selectors", () => {
  it("parse on Node 20 and reject every restricted dynamic import shape", async () => {
    const configUrl = new URL("../eslint.config.js", import.meta.url).href;
    const { default: eslintConfig } = (await import(configUrl)) as {
      default: Array<{
        files?: string[];
        rules?: Record<string, unknown>;
      }>;
    };
    const boundaryConfig = eslintConfig.find(
      (config) =>
        "files" in config &&
        config.files?.some((pattern) => pattern.includes("src/streaming/")) &&
        config.rules?.["no-restricted-syntax"],
    );
    const restrictedSyntax = boundaryConfig?.rules?.["no-restricted-syntax"];
    expect(restrictedSyntax).toBeDefined();

    const messages = new Linter({ configType: "flat" }).verify(
      [
        'import("ai");',
        'import("ai/test");',
        'import("@ai-sdk/provider");',
        'import("vercel");',
        'import("vercel/test");',
        'import("../vercel");',
        'import("../vercel/test");',
      ].join("\n"),
      {
        languageOptions: { ecmaVersion: 2020, sourceType: "module" },
        rules: {
          "no-restricted-syntax": restrictedSyntax as Linter.RuleEntry,
        },
      },
    );

    expect(messages).toHaveLength(7);
    expect(messages.every((message) => message.ruleId === "no-restricted-syntax"))
      .toBe(true);
  });
});
