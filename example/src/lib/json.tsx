import type { ReactNode } from "react";

import { cn } from "./utils";
import { codeBlock } from "./ui";

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className={cn(codeBlock, "mt-2 max-h-[320px] break-normal")}>
      <JsonValue value={value} />
    </pre>
  );
}

function JsonValue({ value }: { value: unknown }) {
  const input = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <>{highlightJson(input)}</>;
}

function highlightJson(input: string) {
  const tokenPattern =
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/gu;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of input.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(input.slice(lastIndex, index));
    }
    const className = token.startsWith('"')
      ? input.slice(index + token.length).trimStart().startsWith(":")
        ? "text-content-accent"
        : "text-green-200"
      : token === "true" || token === "false"
        ? "text-blue-200"
        : token === "null"
          ? "text-content-tertiary"
          : "text-yellow-200";
    nodes.push(
      <span className={className} key={`${index}:${token}`}>
        {token}
      </span>,
    );
    lastIndex = index + token.length;
  }
  if (lastIndex < input.length) {
    nodes.push(input.slice(lastIndex));
  }
  return nodes;
}
