import { useEffect, useLayoutEffect, useRef } from "react";
import {
  ChevronRight,
  FileText,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type { UIMessage } from "ai";

import { MarkdownText } from "./MarkdownText";
import { bubbleText, chip, evidenceChip, prose } from "../lib/ui";
import { cn } from "../lib/utils";

const emptyStateClass =
  "grid min-h-full place-items-center content-center gap-2 p-6 text-content-tertiary text-center [&_strong]:text-content-primary [&_strong]:text-base [&_span]:max-w-[360px] [&_span]:leading-[1.45]";

const bubbleMetaClass =
  "flex items-center gap-2 min-h-[22px] text-content-tertiary text-[12px] [&_strong]:text-content-primary [&_strong]:text-[13px] max-[760px]:min-h-5 max-[760px]:text-[11px] max-[760px]:[&_strong]:text-[12px]";

export function Conversation({
  agentName,
  loading,
  messages,
}: {
  agentName?: string;
  loading: boolean;
  messages: readonly UIMessage[];
}) {
  const threadRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const hasMessages = messages.length > 0;
  const scrollSignature = messages.map(messageScrollSignature).join("|");

  useEffect(() => {
    const thread = threadRef.current;
    const sentinel = sentinelRef.current;
    if (!thread || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        atBottomRef.current = entries.at(-1)?.isIntersecting ?? true;
      },
      { root: thread, rootMargin: "0px 0px 96px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMessages]);

  useEffect(() => {
    const content = contentRef.current;
    const sentinel = sentinelRef.current;
    if (!content || !sentinel) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) sentinel.scrollIntoView({ block: "end" });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasMessages]);

  useLayoutEffect(() => {
    if (!atBottomRef.current) return;
    sentinelRef.current?.scrollIntoView({ block: "end" });
  }, [scrollSignature]);

  if (loading && !hasMessages) {
    return <div className={emptyStateClass}>Loading conversation...</div>;
  }

  if (!hasMessages) {
    return (
      <div className={emptyStateClass}>
        <Sparkles size={22} />
        <strong>Start a support case.</strong>
        <span>Ask a question, attach a file, or request a refund approval.</span>
      </div>
    );
  }

  return (
    <div
      className="app-scroll min-h-0 overflow-auto pt-2 px-1 pb-1 max-[760px]:overflow-x-hidden max-[760px]:px-0 max-[760px]:pb-0"
      ref={threadRef}
    >
      <div
        className="flex flex-col gap-[22px] px-1 max-[760px]:gap-[18px] max-[760px]:px-0"
        ref={contentRef}
      >
        {messages.map((message) => (
          <MessageRow agentName={agentName} message={message} key={message.id} />
        ))}
        <div className="h-px" ref={sentinelRef} aria-hidden />
      </div>
    </div>
  );
}

function MessageRow({
  agentName,
  message,
}: {
  agentName?: string;
  message: UIMessage;
}) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  if (message.role === "system") {
    return null;
  }
  return <AgentMessage agentName={agentName} message={message} />;
}

function AgentShell({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <article className="flex min-w-0 animate-fade-in flex-col">
      <div className="min-w-0 w-full max-w-full">
        <div className={bubbleMetaClass}>
          <strong>{label}</strong>
          {meta ? <span>{meta}</span> : null}
        </div>
        <div className="grid gap-2">{children}</div>
      </div>
    </article>
  );
}

function AgentMessage({
  agentName,
  message,
}: {
  agentName?: string;
  message: UIMessage;
}) {
  const parts = splitParts(message);

  return (
    <AgentShell label={agentName ?? "Support Agent"}>
      {parts.text.length > 0 ? (
        <div className={cn(prose, "max-[760px]:text-[14.5px]")}>
          {parts.text.map((part, index) => (
            <MarkdownText
              text={part.text}
              keyPrefix={message.id}
              key={`${message.id}:text:${index}`}
            />
          ))}
        </div>
      ) : null}
      <Evidence
        keyPrefix={message.id}
        files={parts.files}
        sources={parts.sources}
      />
      {parts.tools.map((part, index) => (
        <div
          className="flex items-center gap-2 px-[11px] py-[9px] rounded-lg border border-edge-soft bg-[rgba(42,40,37,0.58)] text-content-secondary text-[13px]"
          key={`${message.id}:tool:${index}`}
        >
          <ShieldCheck size={14} />
          <span>{toolLabel(part)}</span>
        </div>
      ))}
      {parts.reasoning.length > 0 ? (
        <Reasoning
          text={parts.reasoning.map((part) => part.text).join("\n\n")}
          keyPrefix={message.id}
        />
      ) : null}
    </AgentShell>
  );
}

function UserMessage({ message }: { message: UIMessage }) {
  const parts = splitParts(message);
  return (
    <article className="flex min-w-0 animate-fade-in justify-end">
      <div className="min-w-0 max-w-[min(560px,88%)] max-[760px]:max-w-[min(82vw,360px)] max-[430px]:max-w-[min(78vw,300px)]">
        <div className={cn(bubbleMetaClass, "justify-end")}>
          <strong>Customer</strong>
        </div>
        {parts.text.length > 0 ? (
          <div
            className={cn(
              bubbleText,
              "max-[760px]:px-3 max-[760px]:leading-[1.5]",
            )}
          >
            {parts.text.map((part, index) => (
              <MarkdownText
                text={part.text}
                keyPrefix={message.id}
                key={`${message.id}:text:${index}`}
              />
            ))}
          </div>
        ) : null}
        <Evidence
          keyPrefix={message.id}
          files={parts.files}
          sources={parts.sources}
        />
      </div>
    </article>
  );
}

function splitParts(message: UIMessage) {
  type Part = UIMessage["parts"][number];
  const text: Extract<Part, { type: "text" }>[] = [];
  const reasoning: Extract<Part, { type: "reasoning" }>[] = [];
  const files: EvidenceItem[] = [];
  const sources: EvidenceItem[] = [];
  const tools: Part[] = [];

  for (const part of message.parts) {
    switch (part.type) {
      case "text":
        text.push(part);
        break;
      case "reasoning":
        reasoning.push(part);
        break;
      case "file":
        files.push({ label: part.filename ?? part.url ?? "file" });
        break;
      case "source-url":
        sources.push({ label: part.title ?? part.url });
        break;
      case "source-document":
        sources.push({ label: part.title ?? part.filename ?? part.sourceId });
        break;
      case "dynamic-tool":
        tools.push(part);
        break;
      default:
        collectDataPart(part, files, sources, tools);
    }
  }

  return { text, reasoning, files, sources, tools };
}

type EvidenceItem = { label: string };

function Evidence({
  files,
  sources,
  keyPrefix,
}: {
  files: EvidenceItem[];
  sources: EvidenceItem[];
  keyPrefix: string;
}) {
  if (files.length === 0 && sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-[6px] mt-2">
      {files.map((file, index) => (
        <span className={cn(chip, evidenceChip)} key={`${keyPrefix}:file:${index}`}>
          <FileText size={13} />
          {file.label}
        </span>
      ))}
      {sources.map((source, index) => (
        <span
          className={cn(chip, evidenceChip)}
          key={`${keyPrefix}:source:${index}`}
        >
          <Search size={13} />
          {source.label}
        </span>
      ))}
    </div>
  );
}

function Reasoning({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  return (
    <details className="text-content-secondary text-[12px] [&[open]_summary_svg]:rotate-90">
      <summary className="inline-flex items-center gap-1 w-fit text-content-tertiary cursor-pointer transition-colors duration-[120ms] hover:text-content-secondary list-none marker:hidden [&::-webkit-details-marker]:hidden [&_svg]:transition-transform">
        <ChevronRight size={13} />
        <span>Reasoning</span>
      </summary>
      <div className="mt-1.5 pl-[9px] border-l-2 border-edge-soft text-content-secondary leading-[1.55]">
        <MarkdownText text={text} keyPrefix={keyPrefix} />
      </div>
    </details>
  );
}

function collectDataPart<Part>(
  part: Part,
  files: EvidenceItem[],
  sources: EvidenceItem[],
  tools: Part[],
) {
  if (typeof part !== "object" || part === null) {
    return;
  }
  const candidate = part as { type?: unknown; data?: unknown };
  if (typeof candidate.type !== "string") {
    return;
  }
  const data =
    typeof candidate.data === "object" && candidate.data !== null
      ? (candidate.data as Record<string, unknown>)
      : undefined;
  if (candidate.type === "data-agent-file" && data) {
    const filename = data.filename;
    const fileId = data.fileId;
    files.push({
      label:
        typeof filename === "string"
          ? filename
          : typeof fileId === "string"
            ? fileId
            : "file",
    });
    return;
  }
  if (candidate.type === "data-agent-source" && data) {
    const title = data.title;
    const id = data.id;
    sources.push({
      label: typeof title === "string" ? title : typeof id === "string" ? id : "source",
    });
    return;
  }
  if (
    candidate.type === "data-agent-approval-request" ||
    candidate.type === "data-agent-approval-response"
  ) {
    tools.push(part as Part);
  }
}

function toolLabel(part: UIMessage["parts"][number]) {
  if (part.type === "dynamic-tool") {
    switch (part.state) {
      case "input-available":
        return `${part.toolName} requested`;
      case "approval-requested":
        return `${part.toolName} needs approval`;
      case "output-available":
        return `${part.toolName} completed`;
      case "output-error":
        return `${part.toolName} failed`;
      default:
        return part.toolName;
    }
  }
  if (typeof part === "object" && part !== null) {
    const candidate = part as { type?: unknown; data?: unknown };
    if (candidate.type === "data-agent-approval-request") {
      return "Approval requested";
    }
    if (candidate.type === "data-agent-approval-response") {
      const data =
        typeof candidate.data === "object" && candidate.data !== null
          ? (candidate.data as Record<string, unknown>)
          : undefined;
      return data?.approved === true ? "Approval granted" : "Approval denied";
    }
  }
  return "Tool activity";
}

function messageScrollSignature(message: UIMessage) {
  return `${message.id}:${message.parts
    .map((part) =>
      part.type === "text" || part.type === "reasoning" ? part.text.length : part.type,
    )
    .join(",")}`;
}
