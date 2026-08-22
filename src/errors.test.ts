import { APICallError } from "@ai-sdk/provider";
import { describe, expect, test } from "vitest";
import { errorToString } from "./errors.js";

describe("errorToString", () => {
  test("preserves provider error classifications", () => {
    const details = {
      error: {
        code: "invalid_prompt",
        message: "Invalid prompt: flagged by policy",
      },
    };
    const apiError = new APICallError({
      message: "Invalid prompt: flagged by policy",
      url: "https://api.example.test",
      requestBodyValues: {},
      statusCode: 400,
      data: details,
    });

    expect(errorToString(details)).toBe(
      "invalid_prompt: Invalid prompt: flagged by policy",
    );
    expect(errorToString(apiError)).toBe(
      "invalid_prompt: Invalid prompt: flagged by policy",
    );
    expect(errorToString(new Error())).toBe("Error");
    expect(errorToString(new TypeError())).toBe("TypeError");
    const systemError = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    expect(errorToString(systemError)).toBe("socket hang up");
    const codeOnly = Object.assign(new Error("Request failed"), {
      data: { code: "rate_limit" },
    });
    expect(errorToString(codeOnly)).toBe("rate_limit: Request failed");
  });

  test("serializes objects without mistaking shared values for cycles", () => {
    const shared = { detail: "provider disconnected" };
    const circular: Record<string, unknown> = { shared };
    circular.self = circular;

    expect(errorToString({ x: shared, y: shared })).toBe(
      '{"x":{"detail":"provider disconnected"},"y":{"detail":"provider disconnected"}}',
    );
    expect(errorToString(circular)).toBe(
      '{"shared":{"detail":"provider disconnected"},"self":"[Circular]"}',
    );
  });

  test("bounds stored error text without splitting surrogate pairs", () => {
    const serialized = errorToString(`${"x".repeat(1022)}😀tail`);

    expect(serialized.length).toBeLessThanOrEqual(1024);
    expect(serialized.endsWith("x…")).toBe(true);
  });
});
