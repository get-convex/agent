import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ReasoningMessagePartProps,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
  WrenchIcon,
  CircleAlertIcon,
  SquareIcon,
} from "lucide-react";
import { MarkdownText } from "./markdown-text";
import { TooltipIconButton } from "./tooltip-icon-button";
import { Button } from "@/components/ui/button";

// A focused version of assistant-ui's registry Thread: retain its layout and
// styling, with only the capabilities implemented by this Convex example.
export function Thread() {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background flex h-full flex-col"
      style={{ ["--thread-max-width" as string]: "44rem" }}
    >
      <ThreadPrimitive.Viewport className="relative flex flex-1 flex-col overflow-y-auto scroll-smooth">
        <div className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-1 flex-col px-4 pt-4">
          <ThreadPrimitive.Empty>
            <div className="my-auto py-8 text-center">
              <h2 className="text-2xl font-medium tracking-tight">
                How can I help you today?
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask me to tell you a story.
              </p>
            </div>
          </ThreadPrimitive.Empty>
          <div className="mb-8 flex flex-col gap-6 empty:hidden">
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
          </div>
          <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mt-auto flex flex-col gap-4 rounded-t-3xl bg-background pb-4 md:pb-6">
            <ThreadPrimitive.ScrollToBottom asChild>
              <TooltipIconButton
                tooltip="Scroll to bottom"
                variant="outline"
                className="absolute -top-12 self-center rounded-full p-4 disabled:invisible"
              >
                <ArrowDownIcon />
              </TooltipIconButton>
            </ThreadPrimitive.ScrollToBottom>
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="aui-composer-root flex w-full flex-col gap-2 rounded-3xl border border-border/60 bg-card p-2">
      <ComposerPrimitive.Input
        aria-label="Message input"
        placeholder="Send a message..."
        className="aui-composer-input max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none placeholder:text-muted-foreground/60"
        rows={1}
        autoFocus
      />
      <div className="flex justify-end">
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              variant="default"
              className="size-7 rounded-full"
              aria-label="Send message"
            >
              <ArrowUpIcon className="size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              size="icon"
              className="size-7 rounded-full"
              aria-label="Stop generating"
            >
              <SquareIcon className="size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </ComposerPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="aui-user-message-root flex justify-end px-2 py-3">
      <div className="aui-user-message-content max-w-[85%] break-words rounded-xl bg-muted px-4 py-2 text-foreground">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="aui-assistant-message-root px-2 py-3">
      <div className="break-words leading-relaxed text-foreground">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning,
            tools: { Fallback: ToolResult },
          }}
        />
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            <ErrorPrimitive.Message />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="mt-2 flex text-muted-foreground"
      >
        <ActionBarPrimitive.Copy asChild>
          <TooltipIconButton tooltip="Copy">
            <AuiIf condition={(s) => s.message.isCopied}>
              <CheckIcon />
            </AuiIf>
            <AuiIf condition={(s) => !s.message.isCopied}>
              <CopyIcon />
            </AuiIf>
          </TooltipIconButton>
        </ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function Reasoning({ text }: ReasoningMessagePartProps) {
  return (
    <details className="my-2 text-sm text-muted-foreground">
      <summary className="cursor-pointer py-1">Reasoning</summary>
      <div className="border-l pl-4 whitespace-pre-wrap">{text}</div>
    </details>
  );
}

function ToolResult({
  toolName,
  argsText,
  result,
  isError,
  status,
}: ToolCallMessagePartProps) {
  // Tools execute on the server; this card only displays their progress.
  const failed = isError || status.type === "incomplete";
  const running = !failed && status.type === "running";
  const label = failed ? "Failed" : running ? "Running" : "Complete";
  const StatusIcon = failed
    ? CircleAlertIcon
    : running
      ? LoaderCircleIcon
      : CheckIcon;
  const title = toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ");
  let input = argsText;
  try {
    input = JSON.stringify(JSON.parse(argsText), null, 2);
  } catch {
    // Arguments may still be arriving; display partial JSON as received.
  }

  return (
    <details className="aui-tool-fallback-root group my-3 overflow-hidden rounded-xl border border-border/70 bg-muted/20 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground">
          <WrenchIcon className="size-4" aria-hidden="true" />
        </span>
        <span
          className="min-w-0 flex-1 truncate font-medium capitalize"
          title={toolName}
        >
          {title}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${failed ? "bg-destructive/10 text-destructive" : running ? "bg-muted text-muted-foreground" : "bg-emerald-500/10 text-emerald-700"}`}
          role="status"
        >
          <StatusIcon
            className={`size-3 ${running ? "animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden="true"
          />
          {label}
        </span>
        <ChevronDownIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-4 border-t border-border/60 bg-background px-4 py-3">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Input</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
            {input || "Waiting for input…"}
          </pre>
        </div>
        {result !== undefined ? (
          <div className="space-y-2">
            <p
              className={`text-xs font-medium ${failed ? "text-destructive" : "text-muted-foreground"}`}
            >
              {failed ? "Error" : "Result"}
            </p>
            {Array.isArray(result) &&
            result.length > 0 &&
            result.every((item) => typeof item === "string") ? (
              <ul className="flex flex-wrap gap-2" aria-label="Tool results">
                {result.map((item, index) => (
                  <li
                    key={index}
                    className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-xs"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <pre
                className={`max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg p-3 font-mono text-xs leading-relaxed ${failed ? "bg-destructive/5 text-destructive" : "bg-muted/50"}`}
              >
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {running
              ? "Waiting for the tool to respond…"
              : failed
                ? "The tool did not return a result."
                : "No result returned."}
          </p>
        )}
      </div>
    </details>
  );
}
