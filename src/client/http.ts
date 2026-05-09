import type { streamText as streamTextAi, ToolSet } from "ai";
import { streamText } from "./streamText.js";
import { createThread } from "./threads.js";
import type {
  ActionCtx,
  AgentComponent,
  AgentPrompt,
  Options,
  Output,
} from "./types.js";
import type { StreamingOptions } from "./streaming.js";

export type HttpStreamOptions = Options & {
  agentName: string;
  userId?: string | null;
  threadId?: string;
  /**
   * Whether to save incremental data (deltas) from streaming responses
   * to the database alongside the HTTP stream. Defaults to false.
   *
   * NOTE: For HTTP flows, `true` is normalized to `{ returnImmediately: true }`
   * so the response body starts streaming without waiting for completion.
   */
  saveStreamDeltas?: boolean | StreamingOptions;
  /** Extra headers to add to the response (e.g. CORS headers). */
  corsHeaders?: Record<string, string>;
};

type StreamTextInputArgs<
  TOOLS extends ToolSet,
  OUTPUT extends Output<any, any, any>,
> = AgentPrompt &
  Omit<
    Parameters<typeof streamTextAi<TOOLS, OUTPUT>>[0],
    "model" | "prompt" | "messages"
  > & {
    tools?: TOOLS;
  };

/**
 * Stream text over HTTP, returning a standard `Response` with a readable
 * text stream body. Wraps {@link streamText} and uses
 * `toTextStreamResponse()` for the body.
 *
 * Response headers include:
 * - `X-Message-Id` — the prompt message ID
 * - `X-Stream-Id` — the delta stream ID (only when `saveStreamDeltas` is set)
 *
 * @example
 * ```ts
 * export const chat = httpAction(async (ctx, request) => {
 *   const { prompt, threadId } = await request.json();
 *   return httpStreamText(ctx, components.agent, { prompt }, {
 *     agentName: "myAgent",
 *     threadId,
 *     model: openai.chat("gpt-4o-mini"),
 *   });
 * });
 * ```
 */
export async function httpStreamText<
  TOOLS extends ToolSet = ToolSet,
  OUTPUT extends Output<any, any, any> = never,
>(
  ctx: ActionCtx,
  component: AgentComponent,
  streamTextArgs: StreamTextInputArgs<TOOLS, OUTPUT>,
  options: HttpStreamOptions,
): Promise<Response> {
  const threadId = await resolveThreadId(ctx, component, options);

  const result = await streamText<TOOLS, OUTPUT>(
    ctx,
    component,
    streamTextArgs,
    {
      ...options,
      threadId,
      saveStreamDeltas: normalizeHttpSaveStreamDeltas(options.saveStreamDeltas),
    },
  );

  const response = result.toTextStreamResponse();
  applyHeaders(response, result, options.corsHeaders);
  return response;
}

/**
 * Stream UI messages over HTTP, returning a standard `Response`
 * using AI SDK's `toUIMessageStreamResponse()` format. This provides
 * richer streaming data including tool calls, reasoning, and sources.
 *
 * @example
 * ```ts
 * export const chat = httpAction(async (ctx, request) => {
 *   const { prompt, threadId } = await request.json();
 *   return httpStreamUIMessages(ctx, components.agent, { prompt }, {
 *     agentName: "myAgent",
 *     threadId,
 *     model: openai.chat("gpt-4o-mini"),
 *   });
 * });
 * ```
 */
export async function httpStreamUIMessages<
  TOOLS extends ToolSet = ToolSet,
  OUTPUT extends Output<any, any, any> = never,
>(
  ctx: ActionCtx,
  component: AgentComponent,
  streamTextArgs: StreamTextInputArgs<TOOLS, OUTPUT>,
  options: HttpStreamOptions,
): Promise<Response> {
  const threadId = await resolveThreadId(ctx, component, options);

  const result = await streamText<TOOLS, OUTPUT>(
    ctx,
    component,
    streamTextArgs,
    {
      ...options,
      threadId,
      saveStreamDeltas: normalizeHttpSaveStreamDeltas(options.saveStreamDeltas),
    },
  );

  const response = result.toUIMessageStreamResponse();
  applyHeaders(response, result, options.corsHeaders);
  return response;
}

async function resolveThreadId(
  ctx: ActionCtx,
  component: AgentComponent,
  options: HttpStreamOptions,
): Promise<string> {
  if (options.threadId) return options.threadId;
  return createThread(ctx, component, {
    userId: options.userId ?? null,
  });
}

/**
 * If callers pass `saveStreamDeltas: true` for an HTTP flow, force
 * `returnImmediately: true` — otherwise `streamText` consumes the stream
 * before returning, which buffers the entire response and defeats the
 * purpose of streaming over HTTP.
 */
export function normalizeHttpSaveStreamDeltas(
  saveStreamDeltas?: boolean | StreamingOptions,
): boolean | StreamingOptions | undefined {
  if (saveStreamDeltas === true) return { returnImmediately: true };
  if (saveStreamDeltas && typeof saveStreamDeltas === "object") {
    return { ...saveStreamDeltas, returnImmediately: true };
  }
  return saveStreamDeltas;
}

function applyHeaders(
  response: Response,
  result: { promptMessageId?: string; streamId?: string },
  corsHeaders?: Record<string, string>,
) {
  if (result.promptMessageId) {
    response.headers.set("X-Message-Id", result.promptMessageId);
  }
  if (result.streamId) {
    response.headers.set("X-Stream-Id", result.streamId);
  }
  if (corsHeaders) {
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
  }
}
