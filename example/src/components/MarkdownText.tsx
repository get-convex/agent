import type { ReactNode } from "react";
import { codeBlock } from "../lib/ui";
import { cn } from "../lib/utils";

type Segment =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "code"; value: string }
  | { type: "url"; value: string };

export function MarkdownText({
  text,
  keyPrefix,
}: {
  text: string;
  keyPrefix?: string;
}) {
  const blocks = splitBlocks(text);
  return (
    <>
      {blocks.map((block, index) => {
        const blockKey = `${keyPrefix ?? ""}:b:${index}`;
        return block.type === "code" ? (
          <pre className={cn(codeBlock, "my-1")} key={blockKey}>
            {block.value}
          </pre>
        ) : (
          <p key={blockKey}>{renderInline(block.value, blockKey)}</p>
        );
      })}
    </>
  );
}

function splitBlocks(text: string) {
  const blocks: Array<{ type: "paragraph" | "code"; value: string }> = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let code: string[] | null = null;

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", value: paragraph.join(" ") });
      paragraph = [];
    }
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (code) {
        blocks.push({ type: "code", value: code.join("\n") });
        code = null;
      } else {
        flushParagraph();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
    } else if (line.trim().length === 0) {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  if (code) blocks.push({ type: "code", value: code.join("\n") });
  return blocks.length > 0 ? blocks : [{ type: "paragraph" as const, value: "" }];
}

function renderInline(text: string, prefix: string) {
  return parseInline(text).map((segment, index) => {
    const segmentKey = `${prefix}:${segment.type}:${segment.value.slice(0, 12)}:${index}`;
    if (segment.type === "bold")
      return (
        <strong className="font-[650] text-content-primary" key={segmentKey}>
          {segment.value}
        </strong>
      );
    if (segment.type === "code")
      return (
        <code
          className="rounded-[4px] border border-edge-soft bg-background-deep px-1 py-px text-[0.92em] text-blue-200"
          key={segmentKey}
        >
          {segment.value}
        </code>
      );
    if (segment.type === "url") {
      return (
        <a href={segment.value} key={segmentKey} target="_blank" rel="noreferrer">
          {segment.value}
        </a>
      );
    }
    return segment.value;
  }) as ReactNode[];
}

function parseInline(text: string): Segment[] {
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/gu;
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, index) });
    }
    if (token.startsWith("**")) {
      segments.push({ type: "bold", value: token.slice(2, -2) });
    } else if (token.startsWith("`")) {
      segments.push({ type: "code", value: token.slice(1, -1) });
    } else {
      segments.push({ type: "url", value: token });
    }
    lastIndex = index + token.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}
