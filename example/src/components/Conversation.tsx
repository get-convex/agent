import { useEffect, useLayoutEffect, useRef } from "react";
import { ChevronRight, FileText, Search, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { presentDraft } from "../state/assistantPresentation";
import { formatTime, partText } from "../lib/format";
import { MarkdownText } from "./MarkdownText";
import {
  bubbleText,
  callout,
  calloutError,
  caret,
  chip,
  evidenceChip,
  prose,
} from "../lib/ui";
import { cn } from "../lib/utils";
import type {
  AssistantBubble,
  ConversationTurn,
  UserBubble,
} from "../state/conversationTurns";
import type { AgentMessageDoc, LiveDraft } from "../state/types";

const emptyStateClass =
  "grid min-h-full place-items-center content-center gap-2 p-6 text-content-tertiary text-center [&_strong]:text-content-primary [&_strong]:text-base [&_span]:max-w-[360px] [&_span]:leading-[1.45]";

const bubbleMetaClass =
  "flex items-center gap-2 min-h-[22px] text-content-tertiary text-[12px] [&_strong]:text-content-primary [&_strong]:text-[13px] max-[760px]:min-h-5 max-[760px]:text-[11px] max-[760px]:[&_strong]:text-[12px]";

export function Conversation({
  agentName,
  loading,
  turns,
}: {
  agentName?: string;
  loading: boolean;
  turns: ConversationTurn[];
}) {
  const threadRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const hasVisibleMessages = turns.length > 0;
  const scrollSignature = turns.map(turnScrollSignature).join("|");

  useEffect(() => {
    const thread = threadRef.current;
    const sentinel = sentinelRef.current;
    if (!thread || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        atBottomRef.current = entries[entries.length - 1]?.isIntersecting ?? true;
      },
      { root: thread, rootMargin: "0px 0px 96px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasVisibleMessages]);

  useEffect(() => {
    const content = contentRef.current;
    const sentinel = sentinelRef.current;
    if (!content || !sentinel) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) sentinel.scrollIntoView({ block: "end" });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasVisibleMessages]);

  useLayoutEffect(() => {
    if (!atBottomRef.current) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    sentinel.scrollIntoView({ block: "end" });
  }, [scrollSignature]);

  if (loading && !hasVisibleMessages) {
    return <div className={emptyStateClass}>Loading conversation...</div>;
  }

  if (!hasVisibleMessages) {
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
        {turns.map((turn) => (
          <ConversationTurnView agentName={agentName} turn={turn} key={turn.key} />
        ))}
        <div className="h-px" ref={sentinelRef} aria-hidden />
      </div>
    </div>
  );
}

function messageTextLength(message: AgentMessageDoc) {
  return (
    message.message?.content.reduce(
      (total, part) =>
        part.type === "text" || part.type === "reasoning"
          ? total + part.text.length
          : total,
      0,
    ) ?? 0
  );
}

function turnScrollSignature(turn: ConversationTurn) {
  const user =
    turn.user?.kind === "message"
      ? `${turn.user.message._id}:${messageTextLength(turn.user.message)}`
      : "";
  const assistant =
    turn.assistant?.kind === "message"
      ? `${turn.assistant.message._id}:${messageTextLength(turn.assistant.message)}`
      : turn.assistant
        ? `${turn.assistant.runId ?? "draft"}:${turn.assistant.draft?.text.length ?? 0}:${turn.assistant.draft?.status ?? "drafting"}`
        : "";
  return `${turn.key}:${user}:${assistant}`;
}

function ConversationTurnView({
  agentName,
  turn,
}: {
  agentName?: string;
  turn: ConversationTurn;
}) {
  return (
    <section className="flex flex-col gap-[7px] max-[760px]:gap-1.5">
      {turn.user ? <UserMessage bubble={turn.user} /> : null}
      {turn.assistant ? (
        <AssistantBubbleView agentName={agentName} bubble={turn.assistant} />
      ) : null}
    </section>
  );
}

function AssistantBubbleView({
  agentName,
  bubble,
}: {
  agentName?: string;
  bubble: AssistantBubble;
}) {
  return bubble.kind === "message" ? (
    <AgentMessage message={bubble.message} />
  ) : (
    <AgentDraft agentName={agentName} draft={bubble.draft} />
  );
}

function AgentShell({
  label,
  meta,
  live,
  children,
}: {
  label: string;
  meta?: string;
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <article className="flex min-w-0 animate-fade-in flex-col">
      <div className="min-w-0 w-full max-w-full">
        <div className={bubbleMetaClass}>
          <strong>{label}</strong>
          {meta ? (
            <span className={live ? "text-blue-200 animate-pulse" : undefined}>
              {meta}
            </span>
          ) : null}
        </div>
        <div className="grid gap-2">{children}</div>
      </div>
    </article>
  );
}

function AgentDraft({
  agentName,
  draft,
}: {
  agentName?: string;
  draft: LiveDraft | null;
}) {
  const view = presentDraft(draft);
  return (
    <AgentShell
      label={agentName ?? "Support Agent"}
      meta={view.phase === "streaming" ? view.statusLabel : undefined}
      live={view.phase === "streaming"}
    >
      {view.phase === "thinking" ? (
        <p className="w-fit m-0 text-content-secondary text-[15px] animate-pulse">
          Thinking…
        </p>
      ) : view.phase === "streaming" ? (
        <p className="m-0 text-content-secondary text-[15px] leading-[1.65] whitespace-pre-wrap">
          {view.bodyText}
          <span className={caret} aria-hidden />
        </p>
      ) : (
        <div className={cn(prose, "max-[760px]:text-[14.5px]")}>
          <MarkdownText text={view.bodyText} keyPrefix={draft?.runId ?? "draft"} />
        </div>
      )}
      <Evidence
        keyPrefix={draft?.runId ?? "draft"}
        files={
          draft?.files.map((file) => ({
            label: file.filename ?? file.fileId ?? file.url ?? "file",
          })) ?? []
        }
        sources={
          draft?.sources.map((source) => ({
            label: source.title ?? source.id,
          })) ?? []
        }
      />
      {view.showReasoningToggle && view.reasoning ? (
        <Reasoning text={view.reasoning} keyPrefix={draft?.runId ?? "draft"} />
      ) : null}
      {view.error ? (
        <div className={cn(callout, calloutError, "mt-0.5")}>{view.error}</div>
      ) : null}
    </AgentShell>
  );
}

function AgentMessage({ message }: { message: AgentMessageDoc }) {
  const author = message.message?.author;
  const label = author?.type === "agent" ? author.name : "Support Agent";
  const { textParts, fileParts, sourceParts, reasoningParts, toolParts } =
    splitParts(message);

  return (
    <AgentShell label={label} meta={formatTime(message._creationTime)}>
      {textParts.length > 0 ? (
        <div className={cn(prose, "max-[760px]:text-[14.5px]")}>
          {textParts.map((part, index) => (
            <MarkdownText
              text={part.text}
              keyPrefix={message._id}
              key={`${message._id}:text:${index}`}
            />
          ))}
        </div>
      ) : null}
      <Evidence
        keyPrefix={message._id}
        files={fileParts.map((part) => ({
          label: part.filename ?? part.fileId ?? "file",
        }))}
        sources={sourceParts.map((part) => ({
          label: part.title ?? part.id,
        }))}
      />
      {toolParts.map((part, index) => (
        <div
          className="flex items-center gap-2 px-[11px] py-[9px] rounded-lg border border-edge-soft bg-[rgba(42,40,37,0.58)] text-content-secondary text-[13px]"
          key={`${message._id}:tool:${index}`}
        >
          <ShieldCheck size={14} />
          <span>{partText(part)}</span>
        </div>
      ))}
      {reasoningParts.length > 0 ? (
        <Reasoning
          text={reasoningParts.map((part) => part.text).join("\n\n")}
          keyPrefix={message._id}
        />
      ) : null}
    </AgentShell>
  );
}

function UserMessage({ bubble }: { bubble: UserBubble }) {
  const message = bubble.message;
  const { textParts, fileParts, sourceParts } = splitParts(message);
  return (
    <article className="flex min-w-0 animate-fade-in justify-end">
      <div className="min-w-0 max-w-[min(560px,88%)] max-[760px]:max-w-[min(82vw,360px)] max-[430px]:max-w-[min(78vw,300px)]">
        <div className={cn(bubbleMetaClass, "justify-end")}>
          <strong>Customer</strong>
          <span>{formatTime(message._creationTime)}</span>
        </div>
        {textParts.length > 0 ? (
          <div className={cn(bubbleText, "max-[760px]:px-3 max-[760px]:leading-[1.5]")}>
            {textParts.map((part, index) => (
              <MarkdownText
                text={part.text}
                keyPrefix={message._id}
                key={`${message._id}:text:${index}`}
              />
            ))}
          </div>
        ) : null}
        <Evidence
          keyPrefix={message._id}
          files={fileParts.map((part) => ({
            label: part.filename ?? part.fileId ?? "file",
          }))}
          sources={sourceParts.map((part) => ({
            label: part.title ?? part.id,
          }))}
        />
      </div>
    </article>
  );
}

function splitParts(message: AgentMessageDoc) {
  const content = message.message?.content ?? [];
  type Part = (typeof content)[number];
  const textParts: Extract<Part, { type: "text" }>[] = [];
  const fileParts: Extract<Part, { type: "file" }>[] = [];
  const sourceParts: Extract<Part, { type: "source" }>[] = [];
  const reasoningParts: Extract<Part, { type: "reasoning" }>[] = [];
  const toolParts: Part[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        textParts.push(part);
        break;
      case "file":
        fileParts.push(part);
        break;
      case "source":
        sourceParts.push(part);
        break;
      case "reasoning":
        reasoningParts.push(part);
        break;
      case "tool-call":
      case "tool-result":
      case "approval-request":
      case "approval-response":
        toolParts.push(part);
        break;
    }
  }
  return { textParts, fileParts, sourceParts, reasoningParts, toolParts };
}

function Evidence({
  files,
  sources,
  keyPrefix,
}: {
  files: { label: string }[];
  sources: { label: string }[];
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
