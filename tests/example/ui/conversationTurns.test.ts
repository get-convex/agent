import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "@convex-dev/agent/react";

import { buildConversationTurnsFromTimeline } from "../../../example/src/state/conversationTurns";
import type { AgentMessageDoc, AgentRun } from "../../../example/src/state/types";

function message(
  _id: string,
  author: NonNullable<AgentMessageDoc["message"]>["author"],
  text: string,
  overrides: Partial<AgentMessageDoc> = {},
): AgentMessageDoc {
  return {
    _id,
    _creationTime: 1000,
    threadId: "thread",
    order: 0,
    stepOrder: 0,
    status: "success",
    tool: false,
    text,
    message: {
      author,
      content: [{ type: "text", text }],
    },
    ...overrides,
  };
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: "run",
    threadId: "thread",
    agentName: "Support Agent",
    messageId: "user",
    streamId: "stream",
    status: "running",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function messageItem(messageDoc: AgentMessageDoc): AgentTimelineItem {
  return {
    type: "message",
    key: messageDoc.clientKey ?? messageDoc._id,
    message: messageDoc,
  } as AgentTimelineItem;
}

function runItem(runDoc: AgentRun, text: string): AgentTimelineItem {
  return {
    type: "run",
    key: `run:${runDoc.runId}`,
    run: runDoc,
    state: {
      status: runDoc.status,
      content: [{ type: "text", text }],
      text,
      reasoning: "",
      toolCalls: [],
      approvals: [],
      sources: [],
      files: [],
      messages: [],
      data: {},
      done: false,
    },
  } as AgentTimelineItem;
}

describe("buildConversationTurnsFromTimeline", () => {
  it("uses clientKey as the stable user turn key", () => {
    const turns = buildConversationTurnsFromTimeline([
      messageItem(
        message("user", { type: "user", userId: "demo@convex.dev" }, "hello", {
          clientKey: "client",
        }),
      ),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].key).toBe("turn:user:client");
  });

  it("keeps identical text messages separate when their client keys differ", () => {
    const turns = buildConversationTurnsFromTimeline([
      messageItem(
        message("user1", { type: "user", userId: "demo@convex.dev" }, "what", {
          clientKey: "client-1",
        }),
      ),
      messageItem(
        message("user2", { type: "user", userId: "demo@convex.dev" }, "what", {
          clientKey: "client-2",
        }),
      ),
    ]);

    expect(turns.map((turn) => turn.key)).toEqual([
      "turn:user:client-1",
      "turn:user:client-2",
    ]);
  });

  it("attaches a live run draft to the originating user turn", () => {
    const turns = buildConversationTurnsFromTimeline([
      messageItem(message("user", { type: "user", userId: "demo@convex.dev" }, "hello")),
      runItem(run(), "Hi"),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistant?.kind).toBe("draft");
  });

  it("keeps canceled runs attached as stopped drafts", () => {
    const turns = buildConversationTurnsFromTimeline([
      messageItem(message("user", { type: "user", userId: "demo@convex.dev" }, "stop")),
      runItem(run({ status: "canceled" }), ""),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistant?.kind).toBe("draft");
    expect(
      turns[0].assistant?.kind === "draft"
        ? turns[0].assistant.draft?.status
        : undefined,
    ).toBe("stopped");
  });

  it("uses a persisted assistant message instead of a detached run turn", () => {
    const turns = buildConversationTurnsFromTimeline([
      messageItem(message("user", { type: "user", userId: "demo@convex.dev" }, "hello")),
      messageItem(message("assistant", { type: "agent", name: "Support Agent" }, "final")),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistant?.kind).toBe("message");
    expect(turns.some((turn) => turn.key.startsWith("turn:run:"))).toBe(false);
  });

  it("renders continuation drafts as their own turn once content exists", () => {
    const turns = buildConversationTurnsFromTimeline([
      messageItem(message("user", { type: "user", userId: "demo@convex.dev" }, "approve it")),
      messageItem(
        message("assistant", { type: "agent", name: "Support Agent" }, "needs approval"),
      ),
      runItem(run({ runId: "resume" }), "Resuming after approval"),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[1].key).toBe("turn:run:resume");
    expect(turns[1].assistant?.kind).toBe("draft");
  });
});
