import { convexToJson, type Value } from "convex/values";
import type { AgentMessage, AgentMessagePart } from "./validators.js";

export const DEFAULT_RECENT_MESSAGES = 100;

export function isTool(message: AgentMessage) {
  return (
    message.author.type === "tool" ||
    message.content.some(
      (part) => part.type === "tool-call" || part.type === "tool-result",
    )
  );
}

export function extractText(message: AgentMessage) {
  if (message.author.type === "tool") {
    return undefined;
  }
  return joinText(message.content) || undefined;
}

export function joinText(parts: AgentMessagePart[]) {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .filter(Boolean)
    .join(" ");
}

export function extractReasoning(message: AgentMessage) {
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

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: Value): string {
  return JSON.stringify(sortJson(convexToJson(value)));
}

export function valuesEqual(left: Value, right: Value): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function stableHash(value: Value): string {
  let hash = 0xcbf29ce484222325n;
  const input = canonicalJson(value);
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
