import { describe, expect, test, vi } from "vitest";
import type { MessageDoc } from "../../validators.js";
import { listUIMessages } from "./messages.js";
import type { AgentComponent, QueryCtx } from "./types.js";

function messageDoc(overrides: Partial<MessageDoc>): MessageDoc {
  return {
    _id: `message-${overrides.stepOrder ?? 0}`,
    _creationTime: overrides.stepOrder ?? 0,
    threadId: "thread-1",
    order: 0,
    stepOrder: 0,
    status: "success",
    tool: false,
    ...overrides,
  };
}

describe("listUIMessages", () => {
  test("converts a complete canonical order from the grouped query", async () => {
    const groupedQuery = Symbol("listMessagesByThreadIdGroupedByOrder");
    const runQuery = vi.fn().mockResolvedValue({
      page: [
        messageDoc({
          stepOrder: 3,
          message: { role: "assistant", content: "done" },
        }),
        messageDoc({
          stepOrder: 2,
          tool: true,
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "lookup",
                output: { type: "text", value: "result" },
              },
            ],
          },
        }),
        messageDoc({
          stepOrder: 1,
          tool: true,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "lookup",
                input: {},
              },
            ],
          },
        }),
        messageDoc({
          stepOrder: 0,
          message: { role: "user", content: "question" },
        }),
      ],
      continueCursor: "next-order",
      isDone: false,
    });
    const ctx = { runQuery } as unknown as QueryCtx;
    const component = {
      messages: {
        listMessagesByThreadIdGroupedByOrder: groupedQuery,
      },
    } as unknown as AgentComponent;

    const result = await listUIMessages(ctx, component, {
      threadId: "thread-1",
      paginationOpts: { cursor: null, numItems: 1 },
    });

    expect(runQuery).toHaveBeenCalledWith(groupedQuery, {
      order: "desc",
      threadId: "thread-1",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(result.continueCursor).toBe("next-order");
    expect(result.page.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(result.page[1]!.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-lookup",
          toolCallId: "call-1",
          state: "output-available",
          output: "result",
        }),
      ]),
    );
  });

  test("gets a valid component cursor for a zero-item page", async () => {
    const groupedQuery = Symbol("listMessagesByThreadIdGroupedByOrder");
    const runQuery = vi.fn().mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: 'agent-message-order:{"v":1,"done":true}',
    });
    const result = await listUIMessages(
      { runQuery } as unknown as QueryCtx,
      {
        messages: {
          listMessagesByThreadIdGroupedByOrder: groupedQuery,
        },
      } as unknown as AgentComponent,
      {
        threadId: "thread-1",
        paginationOpts: { cursor: null, numItems: 0 },
      },
    );

    expect(runQuery).toHaveBeenCalledWith(groupedQuery, {
      order: "desc",
      threadId: "thread-1",
      paginationOpts: { cursor: null, numItems: 0 },
    });
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toContain("agent-message-order:");
  });
});
