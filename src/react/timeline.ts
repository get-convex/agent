import type { StreamSnapshot } from "@convex-dev/stream";

import type {
  AgentRun,
  AgentRunEvent,
} from "../client/index.js";
import {
  createAgentRunState,
  mergeAgentRunEvents,
  type AgentRunState,
} from "../client/runEvents.js";
import type { AgentMessageDoc } from "../validators.js";

/** Message and live-run item returned in `useAgent().timeline`. @public */
export type AgentTimelineItem =
  | {
      type: "message";
      key: string;
      message: AgentMessageDoc;
    }
  | {
      type: "run";
      key: string;
      run: AgentRun;
      state: AgentRunState;
    };

export function buildAgentTimeline(
  messages: readonly AgentMessageDoc[],
  runs: readonly AgentRun[],
  snapshots: ReadonlyMap<string, StreamSnapshot<AgentRunEvent>>,
): AgentTimelineItem[] {
  const sortedMessages = [...messages].sort(compareMessages);
  const materializedMessageIds = new Set(sortedMessages.map((message) => message._id));
  const messagePositions = new Map(
    sortedMessages.map((message, position) => [message._id, position]),
  );
  const runsByAnchorMessage = new Map<
    string,
    Extract<AgentTimelineItem, { type: "run" }>[]
  >();
  const unanchoredRuns: Extract<AgentTimelineItem, { type: "run" }>[] = [];

  for (const run of runs) {
    if (isRunFullyMaterialized(run, materializedMessageIds)) {
      continue;
    }
    const materialization = getRunMaterialization(run, messagePositions);
    const state = materializeRunTail(
      run,
      snapshots.get(run.runId),
      materialization.messageEventCount,
    );
    if (
      state.content.length === 0 &&
      state.status !== "running" &&
      state.status !== "waiting" &&
      state.status !== "failed" &&
      state.status !== "canceled"
    ) {
      continue;
    }
    const item: Extract<AgentTimelineItem, { type: "run" }> = {
      type: "run",
      key: `run:${run.runId}`,
      run,
      state,
    };
    if (materialization.anchorMessageId) {
      const anchoredRuns =
        runsByAnchorMessage.get(materialization.anchorMessageId) ?? [];
      anchoredRuns.push(item);
      runsByAnchorMessage.set(materialization.anchorMessageId, anchoredRuns);
    } else {
      unanchoredRuns.push(item);
    }
  }

  for (const anchoredRuns of runsByAnchorMessage.values()) {
    anchoredRuns.sort(compareRunItems);
  }
  unanchoredRuns.sort(compareRunItems);

  const items: AgentTimelineItem[] = [];
  for (const message of sortedMessages) {
    items.push({
      type: "message",
      key: message.clientKey ?? message._id,
      message,
    });
    const anchoredRuns = runsByAnchorMessage.get(message._id);
    if (anchoredRuns) {
      items.push(...anchoredRuns);
    }
  }
  items.push(...unanchoredRuns);
  return items;
}

export function materializeRun(
  run: AgentRun | null | undefined,
  snapshot: StreamSnapshot<AgentRunEvent> | null | undefined,
) {
  return materializeRunTail(run, snapshot, 0);
}

export function isTerminal(status: AgentRun["status"]) {
  return status === "success" || status === "failed" || status === "canceled";
}

export function isRunFullyMaterialized(
  run: AgentRun,
  materializedMessageIds: ReadonlySet<string>,
) {
  if (!isTerminal(run.status)) {
    return false;
  }
  const resultMessageIds = run.resultMessageIds ?? [];
  if (resultMessageIds.length === 0) {
    return run.status === "success";
  }
  return resultMessageIds.every((messageId) => materializedMessageIds.has(messageId));
}

function materializeRunTail(
  run: AgentRun | null | undefined,
  snapshot: StreamSnapshot<AgentRunEvent> | null | undefined,
  afterMessageEvents: number,
) {
  const handle = createAgentRunState();
  if (snapshot) {
    mergeAgentRunEvents(handle, skipMaterializedMessages(
      snapshot.events,
      afterMessageEvents,
    ));
  }
  if (run) {
    handle.setStatus(run.status, run.error);
  }
  return handle.value;
}

function skipMaterializedMessages(
  events: StreamSnapshot<AgentRunEvent>["events"],
  count: number,
) {
  if (count === 0) {
    return events;
  }
  let seen = 0;
  let start = 0;
  for (const [index, item] of events.entries()) {
    if (item.event.type === "message") {
      seen += 1;
      if (seen <= count) {
        start = index + 1;
      }
      if (seen === count) {
        break;
      }
    }
  }
  return events.slice(start);
}

function getRunMaterialization(
  run: AgentRun,
  messagePositions: ReadonlyMap<string, number>,
) {
  let anchorMessageId: string | undefined;
  let anchorPosition = -1;
  let messageEventCount = 0;
  for (const [index, messageId] of (run.resultMessageIds ?? []).entries()) {
    const position = messagePositions.get(messageId);
    if (position !== undefined && position > anchorPosition) {
      anchorMessageId = messageId;
      anchorPosition = position;
      messageEventCount = index + 1;
    }
  }
  if (anchorMessageId) {
    return { anchorMessageId, messageEventCount };
  }
  return {
    anchorMessageId:
      run.messageId && messagePositions.has(run.messageId)
        ? run.messageId
        : undefined,
    messageEventCount: 0,
  };
}

function compareMessages(a: AgentMessageDoc, b: AgentMessageDoc) {
  return (
    a.order - b.order ||
    a.stepOrder - b.stepOrder ||
    a._creationTime - b._creationTime ||
    a._id.localeCompare(b._id)
  );
}

function compareRunItems(
  a: Extract<AgentTimelineItem, { type: "run" }>,
  b: Extract<AgentTimelineItem, { type: "run" }>,
) {
  return a.run.createdAt - b.run.createdAt || a.run.runId.localeCompare(b.run.runId);
}
