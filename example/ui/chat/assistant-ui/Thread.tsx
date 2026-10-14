import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ReasoningMessagePartProps,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { PaginationStatus } from "convex/react";
import { ArrowDown, ArrowUp, Check, Copy, Square } from "lucide-react";

export function Thread({
  paginationStatus,
  loadMore,
}: {
  paginationStatus: PaginationStatus;
  loadMore: (count: number) => void;
}) {
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-6">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
          <AuiIf condition={(s) => s.thread.isLoading}>
            <p role="status" className="text-center text-sm text-slate-500">
              Loading conversation…
            </p>
          </AuiIf>
          {paginationStatus === "CanLoadMore" ||
          paginationStatus === "LoadingMore" ? (
            <button
              type="button"
              disabled={paginationStatus === "LoadingMore"}
              onClick={() => loadMore(10)}
              className="self-center rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
            >
              {paginationStatus === "LoadingMore"
                ? "Loading…"
                : "Load earlier messages"}
            </button>
          ) : null}
          <ThreadPrimitive.Empty>
            <div className="my-auto space-y-3 py-12 text-center">
              <h2 className="text-2xl font-semibold text-slate-900">
                Every story starts somewhere.
              </h2>
              <p className="text-slate-500">
                Give the story agent a setting, a character, or a twist.
              </p>
              <ThreadPrimitive.Suggestion
                prompt="Use your character names tool, then tell me a short story about a lighthouse that remembers its visitors."
                send
                className="mx-auto mt-4 block max-w-sm rounded-xl border px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                Tell me a story about a mysterious lighthouse
              </ThreadPrimitive.Suggestion>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{ UserMessage, AssistantMessage }}
          />
          <AuiIf condition={(s) => s.thread.isRunning}>
            <p role="status" className="pb-2 text-sm text-slate-500">
              Writing your story…
            </p>
          </AuiIf>
        </div>
        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-6 w-full max-w-3xl bg-white pb-4 pt-2">
          <ThreadPrimitive.ScrollToBottom
            aria-label="Scroll to latest message"
            className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full border bg-white p-2 shadow-sm disabled:invisible"
          >
            <ArrowDown size={16} />
          </ThreadPrimitive.ScrollToBottom>
          <ComposerPrimitive.Root className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-3 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500">
            <ComposerPrimitive.Input
              autoFocus
              aria-label="Message"
              placeholder="Describe your story…"
              rows={1}
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 outline-none"
            />
            <AuiIf condition={(s) => !s.thread.isRunning}>
              <ComposerPrimitive.Send
                aria-label="Send message"
                className="rounded-xl bg-indigo-600 p-3 text-white disabled:opacity-40"
              >
                <ArrowUp size={18} />
              </ComposerPrimitive.Send>
            </AuiIf>
            <AuiIf condition={(s) => s.thread.isRunning}>
              <ComposerPrimitive.Cancel
                aria-label="Stop response"
                className="rounded-xl bg-slate-900 p-3 text-white disabled:opacity-40"
              >
                <Square size={18} />
              </ComposerPrimitive.Cancel>
            </AuiIf>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="ml-auto max-w-[85%] rounded-2xl bg-slate-100 px-4 py-3 whitespace-pre-wrap">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="w-full space-y-3">
      <div className="prose prose-slate max-w-none break-words">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning,
            tools: { Fallback: ToolCall },
          }}
        />
      </div>
      <AuiIf condition={(s) => s.message.status?.type === "incomplete"}>
        <p role="status" className="text-sm text-slate-500">
          This response ended before completion.
        </p>
      </AuiIf>
      <ActionBarPrimitive.Root hideWhenRunning className="flex">
        <ActionBarPrimitive.Copy
          aria-label="Copy response"
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
        >
          <AuiIf condition={(s) => s.message.isCopied}>
            <Check size={15} />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <Copy size={15} />
          </AuiIf>
        </ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function Reasoning({ text }: ReasoningMessagePartProps) {
  return (
    <details className="not-prose rounded-lg border p-3 text-sm text-slate-600">
      <summary className="cursor-pointer font-medium">Reasoning</summary>
      <p className="mt-2 whitespace-pre-wrap">{text}</p>
    </details>
  );
}

function ToolCall({
  toolName,
  argsText,
  result,
  isError,
  status,
}: ToolCallMessagePartProps) {
  return (
    <details className="not-prose rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {toolName} ·{" "}
        {isError
          ? "Failed"
          : result !== undefined
            ? "Complete"
            : status.type === "running"
              ? "Running…"
              : "Stopped"}
      </summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-600">
        {argsText}
      </pre>
      {result !== undefined && (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-600">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </details>
  );
}

function MarkdownText() {
  return <MarkdownTextPrimitive />;
}
