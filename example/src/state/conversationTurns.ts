import type {
  AgentMessageDoc,
  LiveDraft,
} from "./types";
import type { AgentTimelineItem } from "@convex-dev/agent/react";

export type UserBubble = { kind: "message"; message: AgentMessageDoc };

export type AssistantBubble =
  | { kind: "message"; message: AgentMessageDoc; runId?: string }
  | { kind: "draft"; draft: LiveDraft | null; runId?: string };

export type ConversationTurn = {
  key: string;
  user?: UserBubble;
  assistant?: AssistantBubble;
};

function isUserMessage(message: AgentMessageDoc) {
  return message.message?.author.type === "user";
}

function userTurnKey(message: AgentMessageDoc) {
  return `turn:user:${message.clientKey ?? message._id}`;
}

function lastTurn(turns: ConversationTurn[]) {
  return turns.length > 0 ? turns[turns.length - 1] : undefined;
}

function draftFromRunItem(item: Extract<AgentTimelineItem, { type: "run" }>): LiveDraft {
  const { run, state } = item;
  const status =
    state.error || run.status === "failed"
      ? "error"
      : run.status === "canceled"
        ? "stopped"
        : state.text.length > 0 && run.status === "running"
        ? "streaming"
        : run.status === "success"
          ? "closed"
          : "waiting";
  return {
    runId: run.runId,
    messageId: run.messageId,
    createdAt: run.createdAt,
    status,
    text: state.text,
    reasoning: state.reasoning,
    sources: state.sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
    })),
    files: state.files.map((file) => ({
      fileId: file.fileId,
      filename: file.filename,
      mediaType: file.mediaType,
      url: file.url,
    })),
    error: state.error?.message ?? run.error?.message,
  };
}

export function buildConversationTurnsFromTimeline(timeline: AgentTimelineItem[]) {
  const turns: ConversationTurn[] = [];

  function appendTurn(turn: ConversationTurn) {
    turns.push(turn);
    return turn;
  }

  for (const item of timeline) {
    if (item.type === "message") {
      const message = item.message;
      if (isUserMessage(message)) {
        appendTurn({
          key: userTurnKey(message),
          user: { kind: "message", message },
        });
        continue;
      }
      const assistant: AssistantBubble = {
        kind: "message",
        message,
      };
      const last = lastTurn(turns);
      if (last && !last.assistant) {
        last.assistant = assistant;
      } else {
        appendTurn({
          key: `turn:assistant:${message._id}`,
          assistant,
        });
      }
      continue;
    }

    const assistant: AssistantBubble = {
      kind: "draft",
      draft: draftFromRunItem(item),
      runId: item.run.runId,
    };
    const last = lastTurn(turns);
    if (last?.user && !last.assistant) {
      last.assistant = assistant;
    } else {
      appendTurn({
        key: `turn:run:${item.run.runId}`,
        assistant,
      });
    }
  }

  return turns;
}
