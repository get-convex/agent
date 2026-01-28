import type {
  FilePart,
  ImagePart,
  ReasoningPart,
  Tool,
  ToolCallPart,
  ToolResultPart,
  ToolResultOutput,
  ToolApprovalRequest,
} from "@ai-sdk/provider-utils";
import type {
  ModelMessage,
  TextPart,
  UIDataTypes,
  UIMessagePart,
  UITools,
} from "ai";
import { getErrorMessage } from "@ai-sdk/provider";
import type { JSONValue } from "@ai-sdk/provider";
import type { Message, MessageContentParts } from "./validators.js";

/**
 * Helper function to create a tool model output for approval responses.
 * @see ai `src/prompt/create-tool-model-output.ts`
 */
export async function createToolModelOutput({
  toolCallId,
  input,
  output,
  tool,
  errorMode,
}: {
  toolCallId: string;
  input: unknown;
  output: unknown;
  tool: Tool | undefined;
  errorMode: 'none' | 'text' | 'json';
}): Promise<ToolResultOutput> {
  if (errorMode === 'text') {
    return { type: 'error-text', value: getErrorMessage(output) };
  } else if (errorMode === 'json') {
    return { type: 'error-json', value: toJSONValue(output) };
  }

  if (tool?.toModelOutput) {
    return await tool.toModelOutput({ toolCallId, input, output });
  }

  return typeof output === 'string'
    ? { type: 'text', value: output }
    : { type: 'json', value: toJSONValue(output) };
}

function toJSONValue(value: unknown): JSONValue {
  return value === undefined ? null : (value as JSONValue);
}

export const DEFAULT_RECENT_MESSAGES = 100;

export function isTool(message: Message | ModelMessage) {
  return (
    message.role === "tool" ||
    (message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some((c) => c.type === "tool-call"))
  );
}

export function extractText(message: Message | ModelMessage) {
  switch (message.role) {
    case "user":
      if (typeof message.content === "string") {
        return message.content;
      }
      return joinText(message.content);
    case "assistant":
      if (typeof message.content === "string") {
        return message.content;
      } else {
        return joinText(message.content) || undefined;
      }
    case "system":
      return message.content;
    // we don't extract text from tool messages
  }
  return undefined;
}

export function joinText(
  parts: (
    | UIMessagePart<UIDataTypes, UITools>
    | TextPart
    | ImagePart
    | FilePart
    | ReasoningPart
    | ToolCallPart
    | ToolResultPart
    | MessageContentParts
    | ToolApprovalRequest
  )[],
) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .filter(Boolean)
    .join(" ");
}

export function extractReasoning(message: Message | ModelMessage) {
  if (typeof message.content === "string") {
    return undefined;
  }
  return message.content
    .filter((c) => c.type === "reasoning")
    .map((c) => c.text)
    .join(" ");
}

export const DEFAULT_MESSAGE_RANGE = { before: 2, after: 1 };

export function sorted<T extends { order: number; stepOrder: number }>(
  messages: T[],
  order: "asc" | "desc" = "asc",
): T[] {
  return [...messages].sort(
    order === "asc"
      ? (a, b) => a.order - b.order || a.stepOrder - b.stepOrder
      : (a, b) => b.order - a.order || b.stepOrder - a.stepOrder,
  );
}

export type ModelOrMetadata =
  | string
  | ({ provider: string } & ({ modelId: string } | { model: string }));

export function getModelName(embeddingModel: ModelOrMetadata): string {
  if (typeof embeddingModel === "string") {
    if (embeddingModel.includes("/")) {
      return embeddingModel.split("/").slice(1).join("/");
    }
    return embeddingModel;
  }
  return "modelId" in embeddingModel
    ? embeddingModel.modelId
    : embeddingModel.model;
}

export function getProviderName(embeddingModel: ModelOrMetadata): string {
  if (typeof embeddingModel === "string") {
    return embeddingModel.split("/").at(0)!;
  }
  return embeddingModel.provider;
}
