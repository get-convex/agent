import type { StreamSnapshot } from "@convex-dev/stream";
import { describe, expect, test } from "vitest";

import type { AgentRun, AgentRunEvent } from "../../src/client/index.js";
import type { AgentMessageDoc } from "../../src/validators.js";
import { buildAgentTimeline } from "../../src/react/timeline.js";

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

function snapshot(events: AgentRunEvent[]): StreamSnapshot<AgentRunEvent> {
  return {
    events: events.map((event, index) => ({
      index,
      sequence: index,
      event,
    })),
    cursor: null,
    nextIndex: events.length,
    isDone: false,
    upToDate: true,
    status: "running",
  };
}

describe("buildAgentTimeline", () => {
  test("anchors a live run draft after the prompt message", () => {
    const timeline = buildAgentTimeline(
      [message("user", { type: "user", userId: "demo" }, "hello")],
      [run()],
      new Map([
        [
          "run",
          snapshot([
            { type: "text.delta", text: "draft" },
          ]),
        ],
      ]),
    );

    expect(timeline.map((item) => item.type)).toEqual(["message", "run"]);
    expect(timeline[1]).toMatchObject({
      type: "run",
      state: { text: "draft" },
    });
  });

  test("renders only the unmaterialized tail after persisted result messages", () => {
    const timeline = buildAgentTimeline(
      [
        message("user", { type: "user", userId: "demo" }, "approve it", {
          order: 0,
        }),
        message("assistant-a", { type: "agent", name: "Support Agent" }, "saved A", {
          order: 0,
          stepOrder: 1,
        }),
      ],
      [
        run({
          resultMessageIds: ["assistant-a", "assistant-b"],
        }),
      ],
      new Map([
        [
          "run",
          snapshot([
            { type: "text.delta", text: "draft A" },
            {
              type: "message",
              message: {
                message: {
                  author: { type: "agent", name: "Support Agent" },
                  content: [{ type: "text", text: "saved A" }],
                },
              },
            },
            { type: "text.delta", text: "tail B" },
          ]),
        ],
      ]),
    );

    expect(timeline.map((item) => item.type)).toEqual([
      "message",
      "message",
      "run",
    ]);
    expect(timeline[2]).toMatchObject({
      type: "run",
      state: { text: "tail B" },
    });
  });
});
