import { RAG } from "@convex-dev/rag";
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { WorkflowManager } from "@convex-dev/workflow";
import { OpenRouter } from "@openrouter/sdk";
import {
  Agent,
  defineTool,
  type AgentContextBlock,
  type AgentMessageDoc,
  type AgentModel,
  type AgentRunEvent,
  type AgentUsage,
  type AgentRun,
} from "@convex-dev/agent";
import {
  vAgentStatus,
  vPublicRun,
  type PublicRun,
} from "@convex-dev/agent/validators";
import { v, type Infer } from "convex/values";
import { env } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const sessionIdMaxLength = 128;
export const fallbackUserId = "session:fallback";
const openRouterDefaultModel = "z-ai/glm-5.2";
const openRouterDefaultEmbeddingModel = "qwen/qwen3-embedding-8b";
const openRouterDefaultEmbeddingDimensions = 4096;
export const fileContextPreviewLength = 24_000;
export const supportKnowledgeVersion = "v1";
const openRouterAppTitle = env.OPENROUTER_APP_TITLE ?? "Convex Agent Example";
const openRouterModelId = env.OPENROUTER_MODEL ?? openRouterDefaultModel;
const openRouterEmbeddingModelId =
  env.OPENROUTER_EMBEDDING_MODEL ?? openRouterDefaultEmbeddingModel;

function createOpenRouterClient(apiKey: string) {
  return new OpenRouter({
    apiKey,
    httpReferer: env.OPENROUTER_HTTP_REFERER,
    appTitle: openRouterAppTitle,
  });
}

export { vAgentStatus };

export const vCaseRun = vPublicRun;

export const vCaseStatus = v.union(
  v.literal("open"),
  v.literal("drafting"),
  v.literal("needsApproval"),
  v.literal("resolved"),
);

export const vSupportCase = v.object({
  threadId: v.string(),
  title: v.string(),
  status: vCaseStatus,
  lastRunId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const vCaseRunDoc = v.object({
  _id: v.id("caseRuns"),
  _creationTime: v.number(),
  userId: v.string(),
  clientMessageId: v.string(),
  scenario: v.string(),
  title: v.string(),
  runId: v.string(),
  threadId: v.string(),
  messageId: v.optional(v.string()),
  streamId: v.string(),
  workflowId: v.optional(v.string()),
  fileRefs: v.array(v.id("files")),
  clientIp: v.optional(v.string()),
  userAgent: v.optional(v.string()),
  requestId: v.optional(v.string()),
  createdAt: v.number(),
});

export const vContextBlockDoc = v.object({
  _id: v.id("contextBlocks"),
  _creationTime: v.number(),
  userId: v.string(),
  runId: v.string(),
  source: v.string(),
  name: v.optional(v.string()),
  text: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
});

export const vQuotaSnapshot = v.object({
  value: v.number(),
  ts: v.number(),
});

export const vKnowledgeSeed = v.object({
  userId: v.string(),
  version: v.string(),
  status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
  error: v.optional(v.string()),
});

export function quotaSnapshot(value: { value: number; ts: number }) {
  return {
    value: value.value,
    ts: value.ts,
  };
}

export const vFile = v.object({
  _id: v.id("files"),
  _creationTime: v.number(),
  userId: v.string(),
  filename: v.string(),
  mediaType: v.string(),
  summary: v.string(),
  extractedText: v.optional(v.string()),
  extractionStatus: v.optional(
    v.union(
      v.literal("extracted"),
      v.literal("metadataOnly"),
      v.literal("failed"),
    ),
  ),
  textLength: v.optional(v.number()),
  truncated: v.optional(v.boolean()),
  url: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  size: v.optional(v.number()),
  createdAt: v.number(),
});

export const vSessionId = v.string();

export type Caller = { sessionId: string; userId: string };
export type SupportCase = Infer<typeof vSupportCase>;
export type CaseRun = PublicRun;
export type Scenario = "core" | "approval" | "files";
export type FileDoc = Doc<"files">;
type OpenRouterProvider = {
  kind: "openrouter";
  model: string;
};
export type FallbackModelProvider = { kind: "fallback"; model: "deterministic" };
export type ModelProvider = OpenRouterProvider | FallbackModelProvider;
type RagFilters = {
  source: "support" | "file";
};
type RagMetadata = {
  source: "support" | "file";
  key?: string;
  fileId?: string;
  filename?: string;
  mediaType?: string;
  title?: string;
};

type RagOptions = ConstructorParameters<typeof RAG>[1];
type SupportComponents = {
  agent: ConstructorParameters<typeof Agent>[0];
  rag: ConstructorParameters<typeof RAG>[0];
  rateLimiter: ConstructorParameters<typeof RateLimiter>[0];
  workflow: ConstructorParameters<typeof WorkflowManager>[0];
};

function configuredEmbeddingDimensions() {
  const raw = env.OPENROUTER_EMBEDDING_DIMENSIONS;
  if (raw === undefined || raw.trim() === "") {
    return openRouterDefaultEmbeddingDimensions;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("OPENROUTER_EMBEDDING_DIMENSIONS must be a positive integer.");
  }
  return parsed;
}

export function retrievalConfigured() {
  return (
    env.OPENROUTER_API_KEY !== undefined &&
    env.OPENROUTER_API_KEY !== ""
  );
}

const openRouterEmbeddingModel: RagOptions["textEmbeddingModel"] = {
  specificationVersion: "v3",
  provider: "openrouter",
  modelId: openRouterEmbeddingModelId,
  maxEmbeddingsPerCall: 128,
  supportsParallelCalls: true,
  async doEmbed({ values, abortSignal }) {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter embeddings are not configured.");
    }
    const client = createOpenRouterClient(apiKey);
    const response = await client.embeddings.generate(
      {
        httpReferer: env.OPENROUTER_HTTP_REFERER,
        appTitle: openRouterAppTitle,
        requestBody: {
          model: openRouterEmbeddingModelId,
          input: values,
          dimensions: configuredEmbeddingDimensions(),
          encodingFormat: "float",
        },
      },
      { signal: abortSignal },
    );
    if (typeof response === "string") {
      throw new Error("OpenRouter returned an unexpected embedding response.");
    }
    return {
      embeddings: response.data
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((item) => {
          if (typeof item.embedding === "string") {
            throw new Error("OpenRouter returned base64 embeddings instead of floats.");
          }
          return item.embedding;
        }),
      usage: response.usage
        ? { tokens: response.usage.totalTokens ?? response.usage.promptTokens }
        : undefined,
      warnings: [],
    };
  },
};

export function createRag(components: Pick<SupportComponents, "rag">) {
  return new RAG<RagFilters, RagMetadata>(components.rag, {
    embeddingDimension: configuredEmbeddingDimensions(),
    textEmbeddingModel: openRouterEmbeddingModel,
    filterNames: ["source"],
  });
}

export function createRateLimiter(
  components: Pick<SupportComponents, "rateLimiter">,
) {
  return new RateLimiter(components.rateLimiter, {
    sendRun: { kind: "fixed window", rate: 10, period: MINUTE },
    sendRunIp: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 60 },
    executeTokens: {
      kind: "token bucket",
      rate: 2_000,
      period: MINUTE,
      capacity: 4_000,
    },
  });
}

export function createWorkflow(components: Pick<SupportComponents, "workflow">) {
  return new WorkflowManager(components.workflow);
}

export function callerFromSession(args: { sessionId: string }): Caller {
  const sessionId = args.sessionId.trim();
  if (
    sessionId.length < 8 ||
    sessionId.length > sessionIdMaxLength ||
    !/^[A-Za-z0-9_-]+$/.test(sessionId)
  ) {
    throw new Error("Invalid session.");
  }
  return { sessionId, userId: `session:${sessionId}` };
}

export function messageText(message: AgentMessageDoc | undefined) {
  const text: string[] = [];
  for (const part of message?.message?.content ?? []) {
    if (part.type === "text" || part.type === "reasoning") {
      text.push(part.text);
    }
  }
  return text.join("\n");
}

function promptText(messages: AgentMessageDoc[]) {
  let prompt: string | undefined;
  for (const message of messages) {
    if (message.message?.author.type !== "user") continue;
    for (const part of message.message.content) {
      if (part.type === "text") {
        prompt = part.text;
      }
    }
  }
  return prompt;
}

export function fileSummary(args: {
  extractionStatus: "extracted" | "metadataOnly" | "failed";
  filename: string;
  size: number;
  textLength?: number;
}) {
  const size = `${Math.max(1, Math.ceil(args.size / 1024))} KB`;
  if (args.extractionStatus === "extracted") {
    return `${args.filename} (${size}) uploaded by the app with ${args.textLength ?? 0} characters of extracted text.`;
  }
  if (args.extractionStatus === "failed") {
    return `${args.filename} (${size}) uploaded by the app; text extraction failed.`;
  }
  return `${args.filename} (${size}) uploaded by the app; contents were not extracted.`;
}

function isApprovalPrompt(prompt: string) {
  return /\b(refund|payment|charge|approve|approval)\b/i.test(prompt);
}

export function scenarioFor(args: {
  prompt: string;
  fileRefs: Id<"files">[];
}): Scenario {
  if (args.fileRefs.length > 0) return "files";
  if (isApprovalPrompt(args.prompt)) return "approval";
  return "core";
}

export function caseStatusForRun(run: AgentRun): SupportCase["status"] {
  if (run.status === "waiting") return "needsApproval";
  if (run.status === "pending" || run.status === "running") return "drafting";
  if (run.status === "success") return "resolved";
  return "open";
}

export function configuredModelProvider(): ModelProvider {
  if (env.OPENROUTER_API_KEY) {
    return {
      kind: "openrouter",
      model: openRouterModelId,
    };
  }
  return { kind: "fallback", model: "deterministic" };
}

export function runTitle(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) return "Support conversation";
  return trimmed.length > 64 ? `${trimmed.slice(0, 61)}...` : trimmed;
}

function messageContentForProvider(message: AgentMessageDoc) {
  const lines: string[] = [];
  for (const part of message.message?.content ?? []) {
    if (part.type === "text" || part.type === "reasoning") {
      lines.push(part.text);
    } else if (part.type === "file") {
      lines.push(
        `[Attached file: ${part.filename ?? part.fileId ?? part.url ?? "file"} (${part.mediaType})]`,
      );
    } else if (part.type === "source") {
      lines.push(`[Source: ${part.title ?? part.id}]`);
    } else if (part.type === "tool-call") {
      lines.push(`[Tool call: ${part.name}]`);
    } else if (part.type === "tool-result") {
      lines.push(`[Tool result: ${part.name ?? part.toolCallId}]`);
    }
  }
  return lines.join("\n").trim();
}

function providerRoleForMessage(
  message: AgentMessageDoc,
): "assistant" | "system" | "user" {
  const author = message.message?.author;
  if (!author) return "user";
  if (author.type === "agent") return "assistant";
  if (author.type === "system") return "system";
  return "user";
}

function contextPrompt(context: AgentContextBlock[]) {
  if (context.length === 0) return "";
  return context
    .map((block, index) => {
      const name = block.name ?? `Context ${index + 1}`;
      return `### ${name}\n${block.text}`;
    })
    .join("\n\n");
}

function usageFromOpenRouter(usage: {
  completionTokens?: number;
  completionTokensDetails?: { reasoningTokens?: number | null } | null;
  promptTokens?: number;
  promptTokensDetails?: { cachedTokens?: number } | null;
  totalTokens?: number;
}): AgentUsage {
  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    tokenDetails: {
      input:
        usage.promptTokensDetails?.cachedTokens === undefined
          ? undefined
          : { cachedTokens: usage.promptTokensDetails.cachedTokens },
      output:
        usage.completionTokensDetails?.reasoningTokens === undefined ||
        usage.completionTokensDetails.reasoningTokens === null
          ? undefined
          : { reasoningTokens: usage.completionTokensDetails.reasoningTokens },
    },
  };
}

const deterministicSupportModel: AgentModel = {
  async *execute({ context, messages, run }) {
    const prompt = promptText(messages) ?? "your request";
    if (context.length > 0) {
      yield {
        type: "text.delta",
        text: `I found ${context.length} relevant support note${context.length === 1 ? "" : "s"} for this case. `,
      };
      for (const block of context) {
        yield {
          type: "source",
          source: {
            sourceType: "document",
            id: block.name ?? "context",
            title: block.name ?? "Context",
          },
        };
      }
      yield {
        type: "reasoning.delta",
        text: context.map((block) => block.text).join("\n\n").slice(0, 360),
      };
    }
    yield {
      type: "text.delta",
      text: `Here is a concise support reply for "${prompt}". The case stays in one thread while this response is backed by run ${run.runId.slice(-8)}.`,
    };
    yield {
      type: "usage",
      usage: { inputTokens: 46, outputTokens: 34, totalTokens: 80 },
    };
  },
};

export const openRouterSupportModel: AgentModel = {
  async *execute({ context, messages, run, signal }) {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) {
      yield* deterministicSupportModel.execute({ context, messages, run, signal });
      return;
    }
    const client = createOpenRouterClient(apiKey);
    const system = [
      "You are a concise support agent.",
      "Answer as a support representative in the active case.",
      "Use app-provided context when it is relevant, but do not mention internal run IDs.",
      context.length > 0 ? `App context:\n\n${contextPrompt(context)}` : undefined,
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n\n");
    const providerMessages = [
      { role: "system" as const, content: system },
      ...messages.flatMap((message) => {
        const content = messageContentForProvider(message);
        if (!content) return [];
        return [{ role: providerRoleForMessage(message), content }];
      }),
    ];
    const stream = await client.chat.send(
      {
        chatRequest: {
          model: openRouterModelId,
          messages: providerMessages,
          maxCompletionTokens: 320,
          provider: { sort: "throughput" },
          stream: true,
          sessionId: run.threadId.slice(0, 256),
          temperature: 0.3,
          user: run.userId,
        },
      },
      { signal },
    );
    let finalUsage: AgentUsage | undefined;
    for await (const chunk of stream) {
      if (chunk.error) {
        throw new Error(`OpenRouter error ${chunk.error.code}: ${chunk.error.message}`);
      }
      if (chunk.usage) {
        finalUsage = usageFromOpenRouter(chunk.usage);
      }
      for (const choice of chunk.choices) {
        const content = choice.delta.content;
        if (content) {
          yield { type: "text.delta", text: content };
        }
        const reasoning = choice.delta.reasoning;
        if (reasoning) {
          yield { type: "reasoning.delta", text: reasoning };
        }
      }
    }
    if (finalUsage) {
      const event: AgentRunEvent = { type: "usage", usage: finalUsage };
      yield event;
    }
  },
};

const approvalModel: AgentModel = {
  async *execute({ run }) {
    yield {
      type: "tool.call",
      toolCallId: `refund:${run.runId}`,
      name: "refundPayment",
      input: { paymentId: "pay_demo_123", amount: 42 },
    };
    yield {
      type: "text.delta",
      text: "I refunded $42 to the payment after human approval. I kept the customer reply in the same support case.",
    };
  },
};

export const workflowModel: AgentModel = {
  async *execute({ run }) {
    yield {
      type: "text.delta",
      text: `The app workflow executed this existing run (${run.runId.slice(-8)}) without Agent owning workflow semantics.`,
    };
  },
};

const refundPayment = defineTool({
  description: "Refund a payment.",
  input: v.object({
    paymentId: v.string(),
    amount: v.number(),
  }),
  needsApproval: true,
  execute: async (input) => ({
    refunded: true,
    paymentId: input.paymentId,
    amount: input.amount,
  }),
});

export function createCoreAgent(components: Pick<SupportComponents, "agent">) {
  return new Agent(components.agent, {
    name: "Support Agent",
    model: deterministicSupportModel,
  });
}

export function createApprovalAgent(
  components: Pick<SupportComponents, "agent">,
) {
  return new Agent(components.agent, {
    name: "Support Agent",
    model: approvalModel,
    tools: { refundPayment },
  });
}

export const supportKnowledgeDocs = [
  {
    key: "refund-policy",
    title: "Refund policy",
    text: "Refunds under $50 can be approved immediately after human approval. Larger refunds need manager review.",
  },
  {
    key: "shipping-status",
    title: "Shipping status",
    text: "Orders with tracking prefix DEMO are handled by the support queue and usually update within one business day.",
  },
  {
    key: "agent-boundary",
    title: "Agent composition boundary",
    text: "Agent owns runs, messages, tool approvals, and streams. Apps compose retrieval, files, rate limits, auth, and workflows.",
  },
];
