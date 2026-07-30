import type {
  LanguageModelV4,
  LanguageModelV4Content,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { simulateReadableStream, type ProviderMetadata } from "ai";
import { assert, pick } from "convex-helpers";

export const DEFAULT_TEXT = `
A A A A A A A A A A A A A A A
B B B B B B B B B B B B B B B
C C C C C C C C C C C C C C C
D D D D D D D D D D D D D D D
`;
const DEFAULT_USAGE = {
  inputTokens: {
    total: 3,
    noCache: 3,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 10,
    text: 10,
    reasoning: 0,
  },
};

export type MockModelArgs = {
  provider?: LanguageModelV4["provider"];
  modelId?: LanguageModelV4["modelId"];
  supportedUrls?:
    | LanguageModelV4["supportedUrls"]
    | (() => LanguageModelV4["supportedUrls"]);
  chunkDelayInMs?: number;
  initialDelayInMs?: number;
  /** A list of the responses for multiple steps.
   * For tool calls, the first list would include a tool call part,
   * then the next list would be after the tool response or another tool call.
   * Tool responses come from actual tool calls!
   */
  contentSteps?: LanguageModelV4Content[][];
  /** A single list of content responded from each step.
   * Provide contentSteps instead if you want to do multi-step responses with
   * tool calls.
   */
  content?: LanguageModelV4Content[];
  // provide either content, contentResponses or doGenerate & doStream
  doGenerate?: LanguageModelV4["doGenerate"];
  doStream?: LanguageModelV4["doStream"];
  providerMetadata?: ProviderMetadata;
  fail?:
    | boolean
    | {
        probability?: number;
        error?: string;
      };
};

function atMostOneOf(...args: unknown[]) {
  return args.filter(Boolean).length <= 1;
}

export function mockModel(args?: MockModelArgs): LanguageModelV4 {
  return new MockLanguageModel(args ?? {});
}

export class MockLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4";

  private _supportedUrls: () => LanguageModelV4["supportedUrls"];

  readonly provider: LanguageModelV4["provider"];
  readonly modelId: LanguageModelV4["modelId"];

  doGenerate: LanguageModelV4["doGenerate"];
  doStream: LanguageModelV4["doStream"];

  doGenerateCalls: Parameters<LanguageModelV4["doGenerate"]>[0][] = [];
  doStreamCalls: Parameters<LanguageModelV4["doStream"]>[0][] = [];

  constructor(args: MockModelArgs) {
    assert(
      atMostOneOf(
        args.content,
        args.contentSteps,
        args.doGenerate && args.doStream,
      ),
      "Expected only one of content, contentSteps, or doGenerate and doStream",
    );
    this.provider = args.provider || "mock-provider";
    this.modelId = args.modelId || "mock-model-id";
    const {
      content = [{ type: "text", text: DEFAULT_TEXT }],
      contentSteps = [content],
      chunkDelayInMs = 0,
      initialDelayInMs = 0,
      supportedUrls = {},
    } = args;
    const fail =
      args.fail &&
      (args.fail === true ||
        args.fail.probability === undefined ||
        Math.random() < args.fail.probability);
    const error =
      (typeof args.fail === "object" && args.fail.error) ||
      "Mock error message";
    const metadata = pick(args, ["providerMetadata"]);

    const chunkResponses: LanguageModelV4StreamPart[][] = contentSteps.map(
      (content) => {
        const chunks: LanguageModelV4StreamPart[] = [
          { type: "stream-start", warnings: [] },
        ];
        chunks.push(
          ...content.flatMap((c, ci): LanguageModelV4StreamPart[] => {
            if (c.type !== "text" && c.type !== "reasoning") {
              return [c];
            }
            const metadata = pick(c, ["providerMetadata"]);
            const deltas = c.text.split(" ");
            const parts: LanguageModelV4StreamPart[] = [];
            if (c.type === "reasoning") {
              parts.push({
                type: "reasoning-start",
                id: `reasoning-${ci}`,
                ...metadata,
              });
              parts.push(
                ...deltas.map(
                  (delta, di) =>
                    ({
                      type: "reasoning-delta",
                      delta: (di ? " " : "") + delta,
                      id: `reasoning-${ci}`,
                      ...metadata,
                    }) satisfies LanguageModelV4StreamPart,
                ),
              );
              parts.push({
                type: "reasoning-end",
                id: `reasoning-${ci}`,
                ...metadata,
              });
            } else if (c.type === "text") {
              parts.push({
                type: "text-start",
                id: `txt-${ci}`,
                ...metadata,
              });
              parts.push(
                ...deltas.map(
                  (delta, di) =>
                    ({
                      type: "text-delta",
                      delta: (di ? " " : "") + delta,
                      id: `txt-${ci}`,
                      ...metadata,
                    }) satisfies LanguageModelV4StreamPart,
                ),
              );
              parts.push({
                type: "text-end",
                id: `txt-${ci}`,
                ...metadata,
              });
            }
            return parts;
          }),
        );
        if (fail) {
          chunks.push({
            type: "error",
            error,
          });
        }
        chunks.push({
          type: "finish",
          finishReason: { unified: fail ? "error" : "stop", raw: undefined },
          usage: DEFAULT_USAGE,
          ...(metadata as any),
        });
        return chunks;
      },
    );
    let callIndex = 0;
    this.doGenerate = async (options) => {
      this.doGenerateCalls.push(options);

      if (fail) {
        throw new Error(error);
      }
      if (typeof args.doGenerate === "function") {
        return args.doGenerate(options);
      } else if (Array.isArray(args.doGenerate)) {
        return args.doGenerate[this.doGenerateCalls.length];
      } else if (contentSteps.length) {
        const result = {
          content: contentSteps[callIndex % contentSteps.length],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: DEFAULT_USAGE,
          ...(metadata as any),
          warnings: [],
        };
        callIndex++;
        return result;
      } else {
        throw new Error("Unexpected: no content or doGenerate");
      }
    };
    this.doStream = async (options) => {
      this.doStreamCalls.push(options);

      if (typeof args.doStream === "function") {
        return args.doStream(options);
      } else if (Array.isArray(args.doStream)) {
        return args.doStream[this.doStreamCalls.length];
      } else if (contentSteps) {
        const stream = simulateReadableStream({
          chunks: chunkResponses[callIndex % chunkResponses.length],
          initialDelayInMs,
          chunkDelayInMs,
        });
        callIndex++;

        if (options.abortSignal) {
          options.abortSignal.addEventListener("abort", () => {
            console.warn("abortSignal in mock model not supported");
          });
        }
        return {
          stream,
          request: { body: {} },
          response: { headers: {} },
        };
      } else if (args.doStream) {
        return args.doStream;
      } else {
        throw new Error("Provide either content or doStream");
      }
    };
    this._supportedUrls =
      typeof supportedUrls === "function"
        ? supportedUrls
        : async () => supportedUrls;
  }

  get supportedUrls() {
    return this._supportedUrls();
  }
}
