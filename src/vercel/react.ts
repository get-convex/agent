import { createStreamBuffer, type StreamQueryArgs } from "@convex-dev/stream";
import type { StreamReadResult } from "@convex-dev/stream";
import type {
  ChatTransport,
  UIMessage,
  UIMessageChunk,
} from "ai";
import { Chat } from "@ai-sdk/react";
import {
  useConvex,
  useQuery,
  type ConvexReactClient,
  type Watch,
} from "convex/react";
import type {
  FunctionReference,
} from "convex/server";
import type { Value } from "convex/values";
import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { AgentRun } from "../client/index.js";
import type {
  AgentRunEventItem,
  AgentRunEventRead,
} from "../client/runEvents.js";
import type {
  AgentMessageDoc,
  AgentMessageInput,
  AgentRunEvent,
} from "../validators.js";
import {
  fromVercelMessage,
  toVercelMessages,
} from "./messages.js";
import { toVercelUIMessageStream } from "./streams.js";
import type {
  AgentVercelMessageMetadata,
  AgentVercelUIMessage,
} from "./types.js";

type ScopeArgs = Record<string, Value>;

type ChatSendTrigger = "submit-message" | "regenerate-message";

type ChatSendArgs<UI_MESSAGE extends UIMessage> = {
  chatId: string;
  trigger: ChatSendTrigger;
  messageId?: string;
  message: AgentMessageInput;
  messages: UI_MESSAGE[];
  body?: Value;
  metadata?: Value;
};

type ChatReadArgs = {
  runId: string;
  streamArgs: StreamQueryArgs;
};

type ChatResumeArgs = {
  chatId: string;
  body?: Value;
  metadata?: Value;
};

type ChatCancelArgs = {
  runId: string;
  reason?: string;
};

/** Convex functions consumed by the Vercel `useChat` transport. */
export type AgentChat<Args extends ScopeArgs = ScopeArgs> = {
  /** Query returning persisted Agent messages for the current app scope. */
  list: FunctionReference<"query", "public", Args, AgentMessageDoc[]>;
  /** Mutation that saves the submitted message, starts a run, and schedules execution. */
  send: FunctionReference<
    "mutation",
    "public",
    Args & ChatSendArgs<UIMessage>,
    AgentRun
  >;
  /** Query that authorizes and reads Agent run events for one run. */
  read: FunctionReference<
    "query",
    "public",
    Args & ChatReadArgs,
    AgentRunEventRead
  >;
  /** Optional query used by AI SDK reconnects to find the latest active run. */
  resume?: FunctionReference<
    "query",
    "public",
    Args & ChatResumeArgs,
    AgentRun | null
  >;
  /** Optional mutation used by callers that want aborts to durably cancel runs. */
  cancel?: FunctionReference<
    "mutation",
    "public",
    Args & ChatCancelArgs,
    AgentRun
  >;
};

/** Options for Convex-backed Vercel chat transport creation. */
export type AgentChatTransportOptions = {
  /** Stable AI SDK chat id. Defaults to AI SDK id generation. */
  id?: string;
  /** Number of Agent run events requested per stream read. Defaults to 128. */
  numItems?: number;
  /** Convert thrown stream errors into a user-facing AI SDK stream error. */
  onError?: (error: unknown) => string;
  /**
   * Durably cancel the active Agent run when the AI SDK abort signal fires.
   *
   * @remarks
   * Defaults to `false` because aborting a UI stream and canceling a durable run
   * are different product actions. Apps that map their Stop button directly to
   * AI SDK aborts can opt into durable cancellation here.
   */
  cancelOnAbort?: boolean;
};

/** Return value expected by AI SDK React's `useChat` options. */
export type AgentChatTransportResult<
  Message extends UIMessage = AgentVercelUIMessage,
> = {
  /** Convex realtime-backed AI SDK chat instance. */
  chat: Chat<Message>;
};

/**
 * Create AI SDK `useChat` options backed by Convex realtime.
 *
 * @remarks
 * The returned transport calls app-owned Convex mutations to start Agent runs
 * and then watches app-owned run-event queries over the normal Convex
 * connection. It does not expose Stream IDs.
 *
 * @example
 * ```tsx
 * const chat = useChat(useChatTransport(api.support.chat, { caseId }));
 * ```
 */
export function useChatTransport<
  Args extends ScopeArgs,
  Message extends UIMessage = AgentVercelUIMessage,
>(
  chat: AgentChat<Args>,
  args: Args,
  options: AgentChatTransportOptions = {},
): AgentChatTransportResult<Message> {
  const client = useConvex();
  const agentMessages = useFunctionQuery(chat.list, args) ?? [];
  const messages = useMemo(
    () => toVercelMessages(agentMessages) as Message[],
    [agentMessages],
  );
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const messagesSignature = useMemo(
    () => uiMessagesSignature(messages),
    [messages],
  );
  const configRef = useRef({ chat, args, options });
  configRef.current = { chat, args, options };
  const transport = useMemo(
    () => createLiveChatTransport<Args, Message>(client, configRef),
    [client],
  );
  const chatRef = useRef<Chat<Message> | null>(null);
  const chatIdRef = useRef<string | undefined>(undefined);
  const syncedMessagesSignatureRef = useRef<string | undefined>(undefined);
  let currentChat = chatRef.current;
  if (currentChat === null || chatIdRef.current !== options.id) {
    currentChat = new Chat<Message>({
      id: options.id,
      messages,
      transport,
    });
    chatRef.current = currentChat;
    chatIdRef.current = options.id;
    syncedMessagesSignatureRef.current = messagesSignature;
  }
  const status = useChatStatus(currentChat);
  useEffect(() => {
    const current = chatRef.current;
    if (
      !current ||
      status === "submitted" ||
      status === "streaming" ||
      syncedMessagesSignatureRef.current === messagesSignature
    ) {
      return;
    }
    current.messages = messagesRef.current;
    syncedMessagesSignatureRef.current = messagesSignature;
  }, [messagesSignature, status]);
  return { chat: currentChat };
}

function useChatStatus<Message extends UIMessage>(chat: Chat<Message>) {
  return useSyncExternalStore(
    chat["~registerStatusCallback"],
    () => chat.status,
    () => chat.status,
  );
}

/**
 * Create a Convex realtime-backed AI SDK `ChatTransport`.
 *
 * @remarks
 * This headless helper exists for tests and non-React clients. React apps should
 * prefer {@link useChatTransport}.
 */
export function createChatTransport<
  Args extends ScopeArgs,
  Message extends UIMessage = AgentVercelUIMessage,
>(
  client: Pick<ConvexReactClient, "mutation" | "query" | "watchQuery">,
  chat: AgentChat<Args>,
  args: Args,
  options: AgentChatTransportOptions = {},
): ChatTransport<Message> {
  const readStream = (run: AgentRun, signal?: AbortSignal) =>
    readRunAsUIMessageStream(client, chat, args, run, {
      ...options,
      signal,
    });
  return {
    sendMessages: async (request) => {
      const message = selectMessage(request.messages, request.messageId);
      if (!message) {
        throw new Error("Expected at least one AI SDK message");
      }
      const run = await runMutation(client, chat.send, {
        ...args,
        chatId: request.chatId,
        trigger: request.trigger,
        messageId: request.messageId,
        message: fromVercelMessage(message),
        messages: request.messages,
        body: toConvexValue(request.body),
        metadata: toConvexValue(request.metadata),
      });
      if (options.cancelOnAbort && chat.cancel) {
        request.abortSignal?.addEventListener(
          "abort",
          () => {
            void runMutation(client, chat.cancel!, {
              ...args,
              runId: run.runId,
              reason: "aborted",
            });
          },
          { once: true },
        );
      }
      return readStream(run, request.abortSignal);
    },
    reconnectToStream: async (request) => {
      if (!chat.resume) {
        return null;
      }
      const run = await runQuery(client, chat.resume, {
        ...args,
        chatId: request.chatId,
        body: toConvexValue(request.body),
        metadata: toConvexValue(request.metadata),
      });
      return run ? readStream(run) : null;
    },
  };
}

function createLiveChatTransport<
  Args extends ScopeArgs,
  Message extends UIMessage = AgentVercelUIMessage,
>(
  client: Pick<ConvexReactClient, "mutation" | "query" | "watchQuery">,
  configRef: RefObject<{
    chat: AgentChat<Args>;
    args: Args;
    options: AgentChatTransportOptions;
  }>,
): ChatTransport<Message> {
  return {
    sendMessages: (request) => {
      const { chat, args, options } = configRef.current;
      return createChatTransport<Args, Message>(
        client,
        chat,
        args,
        options,
      ).sendMessages(request);
    },
    reconnectToStream: (request) => {
      const { chat, args, options } = configRef.current;
      return createChatTransport<Args, Message>(
        client,
        chat,
        args,
        options,
      ).reconnectToStream(request);
    },
  };
}

type StreamOptions = AgentChatTransportOptions & {
  signal?: AbortSignal;
};

function readRunAsUIMessageStream<Args extends ScopeArgs>(
  client: Pick<ConvexReactClient, "watchQuery">,
  chat: AgentChat<Args>,
  args: Args,
  run: AgentRun,
  options: StreamOptions,
): ReadableStream<UIMessageChunk> {
  return toVercelUIMessageStream(
    readRunEvents(client, chat.read, args, run.runId, options),
    {
      messageId: run.messageId,
      messageMetadata: metadataForRun(run),
      onError: options.onError,
    },
  );
}

async function* readRunEvents<
  Args extends ScopeArgs,
>(
  client: Pick<ConvexReactClient, "watchQuery">,
  read: FunctionReference<
    "query",
    "public",
    Args & ChatReadArgs,
    AgentRunEventRead
  >,
  args: Args,
  runId: string,
  options: StreamOptions,
): AsyncIterable<AgentRunEventItem> {
  const buffer = createStreamBuffer<AgentRunEvent>({
    numItems: options.numItems,
  });
  const seen = new Set<number>();
  let lastReadKey: string | undefined;
  while (!options.signal?.aborted) {
    const readArgs = {
      ...args,
      runId,
      streamArgs: buffer.streamArgs,
    };
    const watch = watchQuery(client, read, readArgs);
    while (!options.signal?.aborted) {
      const next = await nextWatchResult(watch, lastReadKey, options.signal);
      lastReadKey = readKey(next);
      const snapshot = buffer.merge(toStreamRead(next));
      for (const item of snapshot.events) {
        if (!seen.has(item.index)) {
          seen.add(item.index);
          yield item;
        }
      }
      if (snapshot.isDone) {
        return;
      }
      if (next.page.length > 0 || next.continueCursor !== readArgs.streamArgs.cursor) {
        break;
      }
    }
  }
}

function nextWatchResult(
  watch: {
    localQueryResult(): AgentRunEventRead | undefined;
    onUpdate(callback: () => void): () => void;
  },
  previousKey: string | undefined,
  signal: AbortSignal | undefined,
): Promise<AgentRunEventRead> {
  return new Promise<AgentRunEventRead>((resolve, reject) => {
    const subscription = { unsubscribe: () => {} };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      subscription.unsubscribe();
    };
    const read = () => {
      try {
        const result = watch.localQueryResult();
        if (result !== undefined && readKey(result) !== previousKey) {
          cleanup();
          resolve(result);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onAbort = () => {
      cleanup();
      resolve({
        page: [],
        continueCursor: "",
        nextIndex: 0,
        isDone: true,
        upToDate: true,
        status: "canceled",
        streamStatus: "canceled",
      });
    };
    if (signal?.aborted) {
      resolve({
        page: [],
        continueCursor: "",
        nextIndex: 0,
        isDone: true,
        upToDate: true,
        status: "canceled",
        streamStatus: "canceled",
      });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    subscription.unsubscribe = watch.onUpdate(read);
    read();
  });
}

function useFunctionQuery<Args extends ScopeArgs, Result>(
  query: FunctionReference<"query", "public", Args, Result>,
  args: Args,
): Result | undefined {
  return useQuery(
    query as FunctionReference<"query">,
    args as Record<string, Value>,
  ) as Result | undefined;
}

function runMutation<Args extends ScopeArgs, Result>(
  client: Pick<ConvexReactClient, "mutation">,
  mutation: FunctionReference<"mutation", "public", Args, Result>,
  args: Args,
): Promise<Result> {
  return client.mutation(
    mutation as FunctionReference<"mutation">,
    args,
  ) as Promise<Result>;
}

function runQuery<Args extends ScopeArgs, Result>(
  client: Pick<ConvexReactClient, "query">,
  query: FunctionReference<"query", "public", Args, Result>,
  args: Args,
): Promise<Result> {
  return client.query(
    query as FunctionReference<"query">,
    args,
  ) as Promise<Result>;
}

function watchQuery<Args extends ScopeArgs, Result>(
  client: Pick<ConvexReactClient, "watchQuery">,
  query: FunctionReference<"query", "public", Args, Result>,
  args: Args,
): Watch<Result> {
  return client.watchQuery(
    query as FunctionReference<"query">,
    args,
  ) as Watch<Result>;
}

function toStreamRead(
  read: AgentRunEventRead,
): StreamReadResult<AgentRunEvent> {
  return {
    ...read,
    status: read.streamStatus,
  };
}

function readKey(read: AgentRunEventRead): string {
  const lastIndex = read.page.at(-1)?.index ?? -1;
  return [
    read.continueCursor,
    read.nextIndex,
    read.status,
    read.streamStatus,
    read.isDone,
    read.upToDate,
    read.page.length,
    lastIndex,
  ].join(":");
}

function metadataForRun(run: AgentRun): AgentVercelMessageMetadata {
  return {
    agent: {
      runId: run.runId,
      threadId: run.threadId,
      messageId: run.messageId,
      usage: run.usage,
      error: run.error?.message,
    },
  };
}

function selectMessage(
  messages: readonly UIMessage[],
  messageId: string | undefined,
): UIMessage | undefined {
  if (messageId) {
    return messages.find((message) => message.id === messageId) ?? messages.at(-1);
  }
  return messages.at(-1);
}

function uiMessagesSignature(messages: readonly UIMessage[]): string {
  return messages.map(uiMessageSignature).join("|");
}

function uiMessageSignature(message: UIMessage): string {
  return `${message.id}:${message.role}:${message.parts
    .map((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return `${part.type}:${part.text.length}`;
      }
      return part.type;
    })
    .join(",")}`;
}

function toConvexValue(value: unknown): Value | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as Value;
}
