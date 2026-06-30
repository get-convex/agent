import {
  Output,
  jsonSchema,
  streamText,
  type JSONValue,
  type Instructions,
  type LanguageModelUsage,
  type AssistantModelMessage,
  type ModelMessage,
  type TextStreamPart,
  type ToolModelMessage,
  type ToolResultPart,
  type ToolSet,
  type UserContent,
} from "ai";
import type { JSONSchema7 } from "json-schema";
import { convexToJson, jsonToConvex, v, type Value } from "convex/values";
import {
  defineAgentModel,
  type AgentContextBlock,
  type AgentModel,
  type AnyAgentTools,
} from "../client/index.js";
import type {
  AgentError,
  AgentMessage,
  AgentMessageDoc,
  AgentMessagePart,
  AgentRunEvent,
  AgentUsage,
} from "../validators.js";

type AnyOutput = Output.Output<unknown, unknown, unknown>;
type RuntimeContext = Record<string, unknown>;
type ToolResultOutput = ToolResultPart["output"];
type StreamTextOptions<OutputSpec extends AnyOutput> = Parameters<
  typeof streamText<ToolSet, RuntimeContext, OutputSpec>
>[0];
type JsonSchema = JSONSchema7;
type AgentOwnedStreamTextOption =
  | "prompt"
  | "messages"
  | "abortSignal"
  | "tools"
  | "toolChoice"
  | "activeTools"
  | "toolOrder"
  | "toolApproval"
  | "experimental_toolApprovalSecret"
  | "stopWhen"
  | "prepareStep"
  | "runtimeContext"
  | "toolsContext"
  | "experimental_repairToolCall"
  | "experimental_refineToolInput"
  | "onToolExecutionStart"
  | "onToolExecutionEnd"
  | "experimental_onToolCallStart"
  | "experimental_onToolCallFinish";

/**
 * Options for adapting an AI SDK 7 language model into an Agent model.
 *
 * @remarks
 * This is intentionally the AI SDK server-side surface minus Agent-owned
 * concerns. Agent owns durable messages, tools, tool approval, run lifecycle,
 * usage/output persistence, and Stream-backed events; the Vercel adapter owns
 * translating those Agent inputs into an AI SDK `streamText` call.
 *
 * @typeParam OutputSpec - Optional AI SDK structured output specification.
 *
 * @public
 */
export type ModelOptions<
  OutputSpec extends AnyOutput = ReturnType<typeof Output.text>,
> = Omit<
  StreamTextOptions<OutputSpec>,
  AgentOwnedStreamTextOption
>;

/**
 * Define an Agent model backed by Vercel AI SDK 7 `streamText`.
 *
 * @remarks
 * Import this from `@convex-dev/agent/vercel` when an app wants AI SDK model
 * providers and settings while keeping Agent core provider-agnostic. The
 * adapter maps AI SDK text, reasoning, sources, files, tool calls/results,
 * usage, and structured output into Agent-owned run events.
 *
 * @typeParam OutputSpec - Optional AI SDK structured output specification.
 * @param options - AI SDK `streamText` options, excluding prompt/messages.
 * @returns An Agent model that can be passed to `new Agent(...)` or
 * `agent.runs.execute(...)`.
 *
 * @example
 * ```ts
 * import { openai } from "@ai-sdk/openai";
 * import { defineModel } from "@convex-dev/agent/vercel";
 *
 * export const supportModel = defineModel({
 *   model: openai("gpt-4.1-mini"),
 *   temperature: 0.2,
 * });
 * ```
 *
 * @public
 */
export function defineModel<
  OutputSpec extends AnyOutput = ReturnType<typeof Output.text>,
>(options: ModelOptions<OutputSpec>): AgentModel {
  return defineAgentModel({
    async *execute(request) {
      const streamOptions = {
        ...options,
        tools: toAiSdkTools(request.tools),
        instructions: mergeInstructions(
          options.instructions,
          request.context,
        ),
        messages: toModelMessages(request.messages),
        abortSignal: request.signal,
      } as StreamTextOptions<OutputSpec>;
      const result = streamText<ToolSet, RuntimeContext, OutputSpec>(
        streamOptions,
      );

      for await (const part of result.stream) {
        if (request.signal?.aborted && part.type === "abort") {
          return;
        }
        const event = toAgentRunEvent(part);
        if (event !== undefined) {
          yield event;
        }
      }

      if (options.output !== undefined && !request.signal?.aborted) {
        try {
          yield { type: "output", value: toValue(await result.output) };
        } catch (error) {
          yield { type: "error", error: toAgentError(error, "output-error") };
        }
      }
    },
  });
}

/** @internal */
export function toModelMessages(
  messages: readonly AgentMessageDoc[],
): ModelMessage[] {
  const modelMessages: ModelMessage[] = [];
  for (const message of messages) {
    const agentMessage = message.message ?? legacyMessage(message);
    appendModelMessage(modelMessages, agentMessage);
  }
  return modelMessages;
}

function appendModelMessage(
  modelMessages: ModelMessage[],
  message: AgentMessage,
) {
  if (message.author.type === "system") {
    const content = messageContentText(message.content);
    if (content.length > 0) {
      modelMessages.push({ role: "system", content });
    }
    return;
  }

  if (message.author.type === "user") {
    const content = toUserContent(message.content);
    if (typeof content === "string" ? content.length > 0 : content.length > 0) {
      modelMessages.push({ role: "user", content });
    }
    return;
  }

  appendAssistantAndToolMessages(modelMessages, message.content);
}

type AssistantContentPart = Exclude<
  AssistantModelMessage["content"],
  string
>[number];
type ToolContentPart = ToolModelMessage["content"][number];

function appendAssistantAndToolMessages(
  modelMessages: ModelMessage[],
  parts: readonly AgentMessagePart[],
) {
  let assistantParts: AssistantContentPart[] = [];
  let toolParts: ToolContentPart[] = [];

  const flushAssistant = () => {
    if (assistantParts.length > 0) {
      modelMessages.push({ role: "assistant", content: assistantParts });
      assistantParts = [];
    }
  };
  const flushTool = () => {
    if (toolParts.length > 0) {
      modelMessages.push({ role: "tool", content: toolParts });
      toolParts = [];
    }
  };

  for (const part of parts) {
    switch (part.type) {
      case "text":
        flushTool();
        assistantParts.push({ type: "text", text: part.text });
        break;
      case "reasoning":
        flushTool();
        assistantParts.push({ type: "reasoning", text: part.text });
        break;
      case "file":
      case "source":
        flushTool();
        assistantParts.push({
          type: "text",
          text: part.type === "file" ? fileLabel(part) : sourceLabel(part),
        });
        break;
      case "tool-call":
        flushTool();
        assistantParts.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.name,
          input: toJsonValue(part.input),
        });
        break;
      case "approval-request":
        flushTool();
        assistantParts.push({
          type: "tool-approval-request",
          approvalId: part.approvalId,
          toolCallId: part.toolCallId,
        });
        break;
      case "tool-result":
        flushAssistant();
        toolParts.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.name ?? part.toolCallId,
          output: toToolResultOutput(part),
        });
        break;
      case "approval-response":
        flushAssistant();
        toolParts.push({
          type: "tool-approval-response",
          approvalId: part.approvalId,
          approved: part.approved,
          reason: part.reason,
        });
        break;
    }
  }

  flushAssistant();
  flushTool();
}

function toUserContent(parts: readonly AgentMessagePart[]): UserContent {
  const text = messageContentText(parts);
  return text.length === 0 ? [] : text;
}

function toToolResultOutput(
  part: Extract<AgentMessagePart, { type: "tool-result" }>,
): ToolResultOutput {
  if (part.error !== undefined) {
    return { type: "error-json", value: toJsonValue(part.error) };
  }
  return { type: "json", value: toJsonValue(part.output ?? null) };
}

function toAiSdkTools(tools: AnyAgentTools | undefined): ToolSet | undefined {
  if (tools === undefined || Object.keys(tools).length === 0) {
    return undefined;
  }
  const aiTools = Object.fromEntries(
    Object.entries(tools).map(([name, agentTool]) => [
      name,
      {
        description: agentTool.description,
        inputSchema: jsonSchema(toJsonSchema(agentTool.input ?? v.any())),
      },
    ]),
  );
  // Tool registries are dynamic object maps, so the AI SDK cannot infer a
  // precise `ToolSet` type here. The adapter intentionally exposes only
  // schemas to the AI SDK; Agent remains responsible for validation, approval,
  // execution, and persistence.
  return aiTools as ToolSet;
}

function mergeInstructions(
  instructions: Instructions | undefined,
  context: readonly AgentContextBlock[],
): Instructions | undefined {
  const contextText = contextInstructions(context);
  if (contextText === undefined) {
    return instructions;
  }
  if (instructions === undefined) {
    return contextText;
  }
  if (typeof instructions === "string") {
    return `${instructions}\n\n${contextText}`;
  }
  const contextMessage = { role: "system" as const, content: contextText };
  if (Array.isArray(instructions)) {
    return [...instructions, contextMessage];
  }
  return [instructions, contextMessage];
}

function contextInstructions(
  context: readonly AgentContextBlock[],
): string | undefined {
  if (context.length === 0) {
    return undefined;
  }
  return [
    "Use this app-provided context when it is relevant:",
    ...context.map((block, index) => {
      const name = block.name ?? `context-${index + 1}`;
      return `<${name}>\n${block.text}\n</${name}>`;
    }),
  ].join("\n\n");
}

function toAgentRunEvent<Tools extends ToolSet>(
  part: TextStreamPart<Tools>,
): AgentRunEvent | undefined {
  switch (part.type) {
    case "text-delta":
      return { type: "text.delta", text: part.text };
    case "reasoning-delta":
      return { type: "reasoning.delta", text: part.text };
    case "source":
      return {
        type: "source",
        source:
          part.sourceType === "url"
            ? {
                sourceType: "url",
                id: part.id,
                url: part.url,
                title: part.title,
              }
            : {
                sourceType: "document",
                id: part.id,
                mediaType: part.mediaType,
                title: part.title,
                filename: part.filename,
              },
      };
    case "file":
      return {
        type: "file",
        file: {
          data: part.file.base64,
          mediaType: part.file.mediaType,
        },
      };
    case "tool-call":
      return {
        type: "tool.call",
        toolCallId: part.toolCallId,
        name: part.toolName,
        input: toValue(part.input),
      };
    case "tool-result":
      return {
        type: "tool.result",
        toolCallId: part.toolCallId,
        name: part.toolName,
        output: toValue(part.output),
      };
    case "tool-error":
      return {
        type: "tool.result",
        toolCallId: part.toolCallId,
        name: part.toolName,
        error: toAgentError(part.error, "tool-error"),
      };
    case "tool-output-denied":
      return {
        type: "tool.result",
        toolCallId: part.toolCallId,
        name: part.toolName,
        error: {
          code: "tool-output-denied",
          message: "Tool output was denied.",
        },
      };
    case "tool-approval-request":
      return {
        type: "approval.request",
        approvalId: part.approvalId,
        toolCallId: part.toolCall.toolCallId,
        name: part.toolCall.toolName,
        input: toValue(part.toolCall.input),
      };
    case "tool-approval-response":
      return {
        type: "approval.response",
        approvalId: part.approvalId,
        toolCallId: part.toolCall.toolCallId,
        approved: part.approved,
        reason: part.reason,
      };
    case "finish-step":
      return undefined;
    case "finish":
      if (finishReason(part.finishReason) === "tool-calls") {
        return undefined;
      }
      return { type: "done", usage: toAgentUsage(part.totalUsage) };
    case "abort":
      return {
        type: "error",
        error: {
          code: "aborted",
          message: part.reason ?? "AI SDK stream was aborted.",
        },
      };
    case "error":
      return { type: "error", error: toAgentError(part.error, "ai-sdk-error") };
    case "reasoning-file":
      return {
        type: "file",
        file: {
          data: part.file.base64,
          mediaType: part.file.mediaType,
        },
      };
    default:
      return undefined;
  }
}

function toAgentUsage(usage: LanguageModelUsage): AgentUsage {
  const input = numericRecord({
    noCacheTokens: usage.inputTokenDetails.noCacheTokens,
    cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
  });
  const output = numericRecord({
    textTokens: usage.outputTokenDetails.textTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
  });
  return withoutUndefined({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    tokenDetails:
      input === undefined && output === undefined
        ? undefined
        : withoutUndefined({ input, output }),
  });
}

function legacyMessage(message: AgentMessageDoc): AgentMessage {
  return {
    author: { type: "agent", name: message.agentName ?? "Assistant" },
    content:
      message.text === undefined
        ? []
        : [{ type: "text", text: message.text }],
  };
}

function messageContentText(parts: readonly AgentMessagePart[]) {
  return parts
    .map((part) => {
      switch (part.type) {
        case "text":
        case "reasoning":
          return part.text;
        case "file":
          return fileLabel(part);
        case "source":
          return sourceLabel(part);
        case "tool-call":
          return `Tool call ${part.name}: ${JSON.stringify(part.input)}`;
        case "tool-result":
          return part.error
            ? `Tool result ${part.name ?? part.toolCallId} failed: ${
                part.error.message
              }`
            : `Tool result ${part.name ?? part.toolCallId}: ${JSON.stringify(
                part.output,
              )}`;
        case "approval-request":
          return `Approval requested for tool call ${part.toolCallId}.`;
        case "approval-response":
          return `Approval ${part.approved ? "granted" : "denied"} for tool call ${
            part.toolCallId
          }${part.reason ? `: ${part.reason}` : ""}.`;
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

function fileLabel(part: Extract<AgentMessagePart, { type: "file" }>) {
  return [
    "File",
    part.filename,
    part.mediaType,
    part.url,
    part.fileId,
  ]
    .filter(Boolean)
    .join(": ");
}

function sourceLabel(part: Extract<AgentMessagePart, { type: "source" }>) {
  return [
    "Source",
    part.title ?? part.id,
    part.url,
    part.mediaType,
  ]
    .filter(Boolean)
    .join(": ");
}

function toAgentError(error: unknown, code: string): AgentError {
  if (error instanceof Error) {
    return { code: error.name || code, message: error.message };
  }
  return { code, message: String(error) };
}

function finishReason(reason: unknown): string | undefined {
  if (typeof reason === "string") {
    return reason;
  }
  if (
    typeof reason === "object" &&
    reason !== null &&
    "unified" in reason &&
    typeof reason.unified === "string"
  ) {
    return reason.unified;
  }
  return undefined;
}

function toJsonValue(value: unknown): JSONValue {
  return convexToJson((value === undefined ? null : value) as Value) as JSONValue;
}

function toJsonSchema(validator: unknown): JsonSchema {
  if (!isRecord(validator) || !("json" in validator)) {
    return {};
  }
  return validatorJsonToJsonSchema(validator.json);
}

function validatorJsonToJsonSchema(validator: unknown): JsonSchema {
  if (!isRecord(validator) || typeof validator.type !== "string") {
    return {};
  }
  switch (validator.type) {
    case "any":
      return {};
    case "null":
    case "number":
    case "boolean":
    case "string":
      return { type: validator.type };
    case "bigint":
      return { type: "number" };
    case "bytes":
    case "id":
      return { type: "string" };
    case "literal":
      return isJsonSchemaLiteral(validator.value)
        ? { const: validator.value }
        : {};
    case "array":
      return {
        type: "array",
        items: validatorJsonToJsonSchema(validator.value),
      };
    case "object":
      return objectValidatorToJsonSchema(validator.value);
    case "record":
      return recordValidatorToJsonSchema(validator);
    case "union":
      return Array.isArray(validator.value)
        ? { anyOf: validator.value.map(validatorJsonToJsonSchema) }
        : {};
    default:
      return {};
  }
}

function objectValidatorToJsonSchema(value: unknown): JsonSchema {
  if (!isRecord(value)) {
    return { type: "object" };
  }
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(value)) {
    if (!isRecord(field)) {
      continue;
    }
    properties[name] = validatorJsonToJsonSchema(field.fieldType);
    if (field.optional !== true) {
      required.push(name);
    }
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function recordValidatorToJsonSchema(validator: Record<string, unknown>): JsonSchema {
  const values = validator.values;
  return {
    type: "object",
    additionalProperties: isRecord(values)
      ? validatorJsonToJsonSchema(values.fieldType)
      : true,
  };
}

function isJsonSchemaLiteral(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toValue(value: unknown): Value {
  if (value === undefined) {
    return null;
  }
  try {
    return jsonToConvex(JSON.parse(JSON.stringify(value)));
  } catch {
    return String(value);
  }
}

function numericRecord(
  record: Record<string, number | undefined>,
): Record<string, number> | undefined {
  const entries = Object.entries(record).filter(
    (entry): entry is [string, number] => entry[1] !== undefined,
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function withoutUndefined<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as {
    [K in keyof T as T[K] extends undefined ? never : K]: Exclude<
      T[K],
      undefined
    >;
  };
}
