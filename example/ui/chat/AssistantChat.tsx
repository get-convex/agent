import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type TextMessagePartProps,
} from "@assistant-ui/react";
import { ArrowDown, ArrowUp, Check, Copy, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ToolResult } from "./AssistantUIToolResult";
import styles from "./AssistantChat.module.css";

// assistant-ui provides behavior; this example owns its scoped presentation.
export function AssistantChat({ canCancel }: { canCancel: boolean }) {
  return (
    <ThreadPrimitive.Root className={styles.thread}>
      <ThreadPrimitive.Viewport className={styles.viewport}>
        <div className={styles.content}>
          <ThreadPrimitive.Empty>
            <div className={styles.welcome}>
              <h2>What story shall we tell?</h2>
              <p>Start with a character, a place, or a little curiosity.</p>
            </div>
          </ThreadPrimitive.Empty>
          <div className={styles.messages}>
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
          </div>
          <ThreadPrimitive.ViewportFooter className={styles.footer}>
            <ThreadPrimitive.ScrollToBottom
              className={styles.scrollButton}
              aria-label="Scroll to latest message"
              title="Scroll to latest message"
            >
              <ArrowDown size={16} />
            </ThreadPrimitive.ScrollToBottom>
            <ComposerPrimitive.Root className={styles.composer}>
              <ComposerPrimitive.Input
                className={styles.input}
                aria-label="Message"
                placeholder="Tell me a story…"
                rows={1}
              />
              <div className={styles.composerActions}>
                <span className={styles.hint}>
                  Enter to send · Shift + Enter for a new line
                </span>
                <AuiIf condition={(s) => !s.thread.isRunning}>
                  <ComposerPrimitive.Send
                    className={styles.sendButton}
                    aria-label="Send message"
                    title="Send message"
                  >
                    <ArrowUp size={18} />
                  </ComposerPrimitive.Send>
                </AuiIf>
                <AuiIf condition={(s) => s.thread.isRunning}>
                  <ComposerPrimitive.Cancel
                    className={styles.sendButton}
                    disabled={!canCancel}
                    aria-label="Stop generating"
                    title="Stop generating"
                  >
                    <Square size={13} fill="currentColor" />
                  </ComposerPrimitive.Cancel>
                </AuiIf>
              </div>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className={styles.userMessage}>
      <div className={styles.userBubble}>
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className={styles.assistantMessage}>
      <MessagePrimitive.Parts
        components={{
          Text: Markdown,
          Reasoning,
          tools: { Fallback: ToolResult },
        }}
      />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className={styles.error}>
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className={styles.actionBar}
      >
        <ActionBarPrimitive.Copy
          className={styles.iconButton}
          aria-label="Copy response"
          title="Copy response"
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
function Markdown({ text }: TextMessagePartProps) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}
// Reasoning remains in the stored message, but is not displayed in this example.
function Reasoning() {
  return null;
}
