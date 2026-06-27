import { describe, expect, it } from "vitest";

import { presentDraft } from "../../../example/src/state/assistantPresentation";
import type { LiveDraft } from "../../../example/src/state/types";

function draft(overrides: Partial<LiveDraft> = {}): LiveDraft {
  return {
    runId: "run",
    messageId: "user",
    createdAt: 1000,
    status: "connecting",
    text: "",
    reasoning: "",
    sources: [],
    files: [],
    ...overrides,
  };
}

describe("presentDraft", () => {
  it("treats a null draft as the thinking phase", () => {
    const view = presentDraft(null);
    expect(view.phase).toBe("thinking");
    expect(view.statusLabel).toBe("Thinking…");
    expect(view.bodyText).toBe("");
  });

  it("keeps reasoning quiet while still waiting for the first token", () => {
    const view = presentDraft(
      draft({ status: "waiting", reasoning: "weighing the options" }),
    );
    expect(view.phase).toBe("thinking");
    expect(view.showReasoningToggle).toBe(false);
    expect(view.reasoning).toBeUndefined();
  });

  it("streams text with a caret and exposes reasoning only behind the toggle", () => {
    const view = presentDraft(
      draft({ status: "streaming", text: "On it", reasoning: "step one" }),
    );
    expect(view.phase).toBe("streaming");
    expect(view.statusLabel).toBe("Writing…");
    expect(view.showCaret).toBe(true);
    expect(view.showReasoningToggle).toBe(true);
    expect(view.reasoning).toBe("step one");
  });

  it("settles to done without a caret once streaming stops", () => {
    const view = presentDraft(draft({ status: "closed", text: "All set" }));
    expect(view.phase).toBe("done");
    expect(view.showCaret).toBe(false);
    expect(view.statusLabel).toBeUndefined();
  });

  it("shows canceled drafts as stopped instead of thinking", () => {
    const view = presentDraft(draft({ status: "stopped" }));
    expect(view.phase).toBe("stopped");
    expect(view.bodyText).toBe("Stopped.");
    expect(view.showCaret).toBe(false);
  });

  it("surfaces errors", () => {
    const view = presentDraft(draft({ status: "error", error: "boom" }));
    expect(view.phase).toBe("error");
    expect(view.error).toBe("boom");
  });
});
