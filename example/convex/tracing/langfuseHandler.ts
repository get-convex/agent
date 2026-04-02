/**
 * LangFuse Tracing Integration
 *
 * This example shows how to integrate LangFuse tracing with the Convex Agent
 * library using the built-in handler callbacks. It uses direct HTTP calls
 * to LangFuse's ingestion API, which works reliably in serverless environments.
 *
 * Setup:
 * 1. Create a LangFuse account at https://langfuse.com
 * 2. Get your API keys from the project settings
 * 3. Set environment variables:
 *    - LANGFUSE_PUBLIC_KEY
 *    - LANGFUSE_SECRET_KEY
 *    - LANGFUSE_BASE_URL (optional, defaults to EU cloud)
 *
 * Learn more:
 * - LangFuse docs: https://langfuse.com/docs
 * - API reference: https://api.reference.langfuse.com
 */

import {
  RawRequestResponseHandler,
  UsageHandler,
} from "@convex-dev/agent";

// LangFuse configuration from environment variables
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
const LANGFUSE_BASE_URL =
  process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";

/**
 * Check if LangFuse is configured
 */
export function isLangfuseConfigured(): boolean {
  return Boolean(LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY);
}

/**
 * Send events to LangFuse's ingestion API
 * Uses the legacy batch ingestion endpoint which accepts trace and generation events.
 *
 * @see https://langfuse.com/docs/api-and-data-platform/features/public-api
 */
async function sendToLangfuse(events: LangfuseEvent[]): Promise<void> {
  if (!isLangfuseConfigured()) {
    console.debug("LangFuse not configured, skipping trace");
    return;
  }

  const batch = events.map((event, index) => ({
    id: `${event.body.id}-event-${index}`,
    timestamp: new Date().toISOString(),
    type: event.type,
    body: event.body,
  }));

  try {
    const response = await fetch(`${LANGFUSE_BASE_URL}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`)}`,
      },
      body: JSON.stringify({ batch }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("LangFuse ingestion failed:", response.status, text);
    }
  } catch (error) {
    console.error("LangFuse ingestion error:", error);
  }
}

// LangFuse event types for the ingestion API
type LangfuseEvent =
  | { type: "trace-create"; body: TraceBody }
  | { type: "generation-create"; body: GenerationBody };

interface TraceBody {
  id: string;
  name: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  tags?: string[];
}

interface GenerationBody {
  id: string;
  traceId: string;
  name: string;
  model?: string;
  modelParameters?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  metadata?: Record<string, unknown>;
  startTime?: string;
  endTime?: string;
}

/**
 * Generate a unique ID for LangFuse traces
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * RawRequestResponseHandler that sends LLM request/response data to LangFuse.
 *
 * This handler is called after each LLM request completes, giving you access
 * to the full request and response metadata.
 *
 * Usage:
 * ```ts
 * const agent = new Agent(components.agent, {
 *   rawRequestResponseHandler: langfuseRequestResponseHandler,
 *   // ... other config
 * });
 * ```
 */
export const langfuseRequestResponseHandler: RawRequestResponseHandler = async (
  _ctx,
  { request, response, agentName, threadId, userId }
) => {
  const traceId = generateId();
  const generationId = generateId();
  const now = new Date().toISOString();

  // Extract model info from the request
  const modelId = request.model?.modelId ?? "unknown";
  const provider = request.model?.provider ?? "unknown";

  // Create a trace for the overall agent interaction
  const traceEvent: LangfuseEvent = {
    type: "trace-create",
    body: {
      id: traceId,
      name: agentName ?? "convex-agent",
      userId: userId ?? undefined,
      sessionId: threadId,
      metadata: {
        threadId,
        provider,
        source: "convex-agent",
      },
      input: request.messages,
      tags: ["convex-agent", provider],
    },
  };

  // Create a generation for the LLM call with detailed metadata
  const generationEvent: LangfuseEvent = {
    type: "generation-create",
    body: {
      id: generationId,
      traceId,
      name: `${provider}/${modelId}`,
      model: modelId,
      modelParameters: {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        topP: request.topP,
        frequencyPenalty: request.frequencyPenalty,
        presencePenalty: request.presencePenalty,
      },
      input: request.messages,
      metadata: {
        responseId: response.id,
        responseModelId: response.modelId,
        responseTimestamp: response.timestamp?.toISOString(),
        responseHeaders: response.headers,
      },
      startTime: now,
      endTime: now,
    },
  };

  await sendToLangfuse([traceEvent, generationEvent]);
};

/**
 * UsageHandler that sends token usage data to LangFuse.
 *
 * This handler is called after each LLM request with usage statistics,
 * allowing you to track costs and token consumption in LangFuse.
 *
 * Note: If you're already using langfuseRequestResponseHandler, the usage
 * data will be included there. This handler is useful if you want to track
 * usage separately or with more detail.
 *
 * Usage:
 * ```ts
 * const agent = new Agent(components.agent, {
 *   usageHandler: langfuseUsageHandler,
 *   // ... other config
 * });
 * ```
 */
export const langfuseUsageHandler: UsageHandler = async (
  _ctx,
  { agentName, threadId, userId, usage, model, provider }
) => {
  const traceId = generateId();
  const generationId = generateId();
  const now = new Date().toISOString();

  // Create a trace for the usage event
  const traceEvent: LangfuseEvent = {
    type: "trace-create",
    body: {
      id: traceId,
      name: `${agentName ?? "convex-agent"}-usage`,
      userId: userId ?? undefined,
      sessionId: threadId,
      metadata: {
        threadId,
        provider,
        model,
        source: "convex-agent-usage",
      },
      tags: ["convex-agent", "usage", provider],
    },
  };

  // Create a generation with usage data
  const generationEvent: LangfuseEvent = {
    type: "generation-create",
    body: {
      id: generationId,
      traceId,
      name: `${provider}/${model}`,
      model,
      usage: {
        input: usage.inputTokens,
        output: usage.outputTokens,
        total: usage.totalTokens,
      },
      metadata: {
        reasoningTokens: usage.reasoningTokens,
        cachedInputTokens: usage.cachedInputTokens,
      },
      startTime: now,
      endTime: now,
    },
  };

  await sendToLangfuse([traceEvent, generationEvent]);
};
