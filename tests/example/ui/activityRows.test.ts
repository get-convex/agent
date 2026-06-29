import { describe, expect, it } from "vitest";

import { STREAM_ROW_LABEL, buildActivityRows } from "../../../example/src/state/activityRows";
import type { StreamState } from "../../../example/src/state/types";

function streamState(overrides: Partial<StreamState> = {}): StreamState {
  return {
    state: "live",
    headers: {},
    chunks: [],
    ...overrides,
  };
}

describe("buildActivityRows", () => {
  it("appends exactly one consolidated stream row with details tucked away", () => {
    const rows = buildActivityRows({
      activity: [
        { label: "Context", status: "closed" },
        { label: "Generation", status: "running" },
      ],
      stream: streamState({ state: "live", chunks: ["chunk"] }),
      streamUrl: "https://example.convex.site/agent/run",
    });

    const streamRows = rows.filter((row) => row.label === STREAM_ROW_LABEL);
    expect(streamRows).toHaveLength(1);
    expect(streamRows[0].status).toBe("streaming");
    expect(streamRows[0].detail).toMatchObject({
      url: "https://example.convex.site/agent/run",
      chunks: ["chunk"],
    });
    expect(rows).toHaveLength(3);
  });

  it("dedupes pre-existing stream rows so only one remains", () => {
    const rows = buildActivityRows({
      activity: [
        { label: STREAM_ROW_LABEL, status: "idle" },
        { label: STREAM_ROW_LABEL, status: "connecting" },
      ],
      stream: streamState({ state: "closed" }),
      streamUrl: undefined,
    });

    expect(rows.filter((row) => row.label === STREAM_ROW_LABEL)).toHaveLength(1);
    expect(rows[rows.length - 1].status).toBe("closed");
  });

  it("maps stream connection state to human status", () => {
    expect(
      buildActivityRows({ activity: [], stream: streamState({ state: "idle" }) })[0]
        .status,
    ).toBe("idle");
    expect(
      buildActivityRows({ activity: [], stream: streamState({ state: "error" }) })[0]
        .status,
    ).toBe("error");
  });
});
