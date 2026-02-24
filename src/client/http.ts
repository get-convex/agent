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

/**
 * Options for HTTP streaming helpers.
 */
export type HttpStreamOptions = Options & {
  /** The agent name attributed to messages. */
  agentName: string;
  /** The user to associate with the thread / messages. */
  userId?: string | null;
  /** The thread to continue. If omitted, a new thread is created. */
  threadId?: string;
  /**
   * Whether to save incremental data (deltas) from streaming responses
   * to the database alongside the HTTP stream. Defaults to false.
   */
  saveStreamDeltas?: boolean | StreamingOptions;
  /**
   * Extra headers to add to the response (e.g. CORS headers).
   */
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
 * Stream text over HTTP, returning a standard `Response` with a
 * readable text stream body. Wraps the standalone {@link streamText}
 * and formats the result with `toTextStreamResponse()`.
 *
 * Response headers include:
 * - `X-Message-Id` — the prompt message ID (for client-side tracking)
 * - `X-Stream-Id` — the delta stream ID (for deduplication with `skipStreamIds`)
 *
 * @example
 * ```ts
 * import { httpStreamText } from "@convex-dev/agent";
 *
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
  const threadId =
    options.threadId ?? (await createThread(ctx, component));

  const result = await streamText<TOOLS, OUTPUT>(
    ctx,
    component,
    streamTextArgs,
    {
      ...options,
      threadId,
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
 * import { httpStreamUIMessages } from "@convex-dev/agent";
 *
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
  const threadId =
    options.threadId ?? (await createThread(ctx, component));

  const result = await streamText<TOOLS, OUTPUT>(
    ctx,
    component,
    streamTextArgs,
    {
      ...options,
      threadId,
    },
  );

  const response = result.toUIMessageStreamResponse();
  applyHeaders(response, result, options.corsHeaders);
  return response;
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
