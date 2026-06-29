import type { LiveDraft } from "./types";

export type AssistantPhase = "thinking" | "streaming" | "done" | "stopped" | "error";

export type AssistantPresentation = {
  phase: AssistantPhase;
  statusLabel?: string;
  bodyText: string;
  showCaret: boolean;
  reasoning?: string;
  showReasoningToggle: boolean;
  error?: string;
};

export function presentDraft(draft: LiveDraft | null): AssistantPresentation {
  const bodyText = draft?.text ?? "";
  const reasoning = draft?.reasoning ?? "";
  const hasReasoning = reasoning.length > 0;
  const reasoningFields = {
    reasoning: hasReasoning ? reasoning : undefined,
    showReasoningToggle: hasReasoning,
  };

  if (draft?.status === "error" || draft?.error) {
    return {
      phase: "error",
      bodyText,
      showCaret: false,
      error: draft?.error,
      ...reasoningFields,
    };
  }

  if (draft?.status === "stopped") {
    return {
      phase: "stopped",
      statusLabel: "Stopped",
      bodyText: bodyText || "Stopped.",
      showCaret: false,
      ...reasoningFields,
    };
  }

  if (bodyText.length > 0) {
    const streaming = draft?.status === "streaming";
    return {
      phase: streaming ? "streaming" : "done",
      statusLabel: streaming ? "Writing…" : undefined,
      bodyText,
      showCaret: streaming,
      ...reasoningFields,
    };
  }

  return {
    phase: "thinking",
    statusLabel: "Thinking…",
    bodyText: "",
    showCaret: false,
    showReasoningToggle: false,
  };
}
