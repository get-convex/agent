/**
 * React primitives for Convex-native Agent runs.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo } from "react";
import {
  useMutation,
  usePaginatedQuery,
  useQuery,
  type PaginatedQueryReference,
} from "convex/react";
import type {
  FunctionReference,
  OptionalRestArgs,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import type { Value } from "convex/values";
import {
  useStreamBufferSet,
  type UseStreamBufferSetResult,
} from "@convex-dev/stream/react";
import type {
  KeyedStreamReadResult,
  StreamQueryArgs,
  StreamSnapshot,
} from "@convex-dev/stream";

import type {
  AgentRun,
  AgentRunEvent,
  AgentRunEventBatchRead,
} from "../client/index.js";
import type { AgentRunState } from "../client/runEvents.js";
import type { AgentMessageDoc, AgentToolCall, AgentUsage } from "../validators.js";
import {
  buildAgentTimeline,
  isRunFullyMaterialized,
  isTerminal,
  materializeRun,
  type AgentTimelineItem,
} from "./timeline.js";

type AgentBaseArgs = Record<string, Value>;
type AgentPaginatedArgs<Args extends AgentBaseArgs> = Args & {
  paginationOpts: PaginationOptions;
};
type AgentRunEventsBatchArgs<Args extends AgentBaseArgs> = Args & {
  reads: Array<{
    runId: string;
    streamArgs: StreamQueryArgs;
  }>;
};
type AgentCancelArgs<Args extends AgentBaseArgs> = Args & {
  runId: string;
  reason?: string;
};
type AgentApprovalArgs<Args extends AgentBaseArgs> = Args & {
  runId: string;
  toolCallId: string;
  reason?: string;
};
type ScopedMutationArgs<
  ScopeArgs extends AgentBaseArgs,
  MutationArgs extends AgentBaseArgs,
> = Omit<MutationArgs, keyof ScopeArgs>;
type MutationRunner<Args, Result> = (args: Args) => Promise<Result>;

/**
 * Server scope consumed by {@link useAgent}.
 *
 * @remarks
 * The referenced Convex functions are app-owned. They should authorize the current user/case,
 * call the Agent core APIs, and expose only run ids to the browser. Stream ids
 * stay internal to Agent.
 *
 * @typeParam Args - Stable app-owned scope arguments, such as `{ caseId }`.
 * @typeParam SendArgs - Public send mutation arguments.
 * @public
 */
export type AgentScope<
  Args extends AgentBaseArgs = AgentBaseArgs,
  SendArgs extends AgentBaseArgs = AgentBaseArgs,
> = {
  /** Paginated query returning persisted Agent messages for the scope. */
  listMessages: FunctionReference<
    "query",
    "public",
    AgentPaginatedArgs<Args>,
    PaginationResult<AgentMessageDoc>
  >;
  /** Paginated query returning recent durable runs for the scope. */
  listRuns: FunctionReference<
    "query",
    "public",
    AgentPaginatedArgs<Args>,
    PaginationResult<AgentRun>
  >;
  /** Query returning Agent run-event reads keyed by run id. */
  readRunEventsBatch: FunctionReference<
    "query",
    "public",
    AgentRunEventsBatchArgs<Args>,
    AgentRunEventBatchRead[]
  >;
  /** Mutation that records a user intent and schedules Agent execution. */
  send: FunctionReference<"mutation", "public", SendArgs, AgentRun>;
  /** Mutation that durably cancels a run. */
  cancel: FunctionReference<"mutation", "public", AgentCancelArgs<Args>, AgentRun>;
  /** Mutation that approves a waiting tool call. */
  approveToolCall: FunctionReference<
    "mutation",
    "public",
    AgentApprovalArgs<Args>,
    AgentRun
  >;
  /** Mutation that denies a waiting tool call. */
  denyToolCall: FunctionReference<
    "mutation",
    "public",
    AgentApprovalArgs<Args>,
    AgentRun
  >;
};

/** Options for {@link useAgent}. @public */
export type UseAgentOptions = {
  /** Number of persisted messages to load initially. Defaults to `50`. */
  initialNumMessages?: number;
  /** Number of recent runs to watch for live events. Defaults to `20`. */
  initialNumRuns?: number;
  /** Number of stream events to read per run-event buffer. Defaults to `128`. */
  initialNumEvents?: number;
};

export type { AgentTimelineItem } from "./timeline.js";

/** Primary React state returned by {@link useAgent}. @public */
export type UseAgentResult<
  Args extends AgentBaseArgs = AgentBaseArgs,
  SendArgs extends AgentBaseArgs = AgentBaseArgs,
> = {
  /** Materialized timeline combining persisted messages and live run drafts. */
  timeline: AgentTimelineItem[];
  /** Persisted messages loaded through Convex pagination. */
  messages: AgentMessageDoc[];
  /** Durable runs loaded through Convex pagination. */
  runs: AgentRun[];
  /** Current non-terminal run, or the most recent run when none is active. */
  activeRun: AgentRun | null;
  /** Non-terminal runs currently backed by local Stream buffers. */
  activeRuns: AgentRun[];
  /** Tool calls waiting for approval, derived from run events. */
  approvals: AgentToolCall[];
  /** Usage for the active or latest run. */
  usage?: AgentUsage;
  /** Aggregate usage for loaded runs. */
  usageTotal?: AgentUsage;
  /** Structured output for the active or latest run. */
  output?: Value;
  /** Overall UI status for the current Agent scope. */
  status: "loading" | "idle" | "running" | "waiting" | "error";
  /** Send a message through the app-owned send mutation. Scope args are merged in. */
  send: (args: ScopedMutationArgs<Args, SendArgs>) => Promise<AgentRun>;
  /** Cancel a durable run. */
  cancel: (args: { runId: string; reason?: string }) => Promise<AgentRun>;
  /** Approve a waiting tool call. */
  approve: (args: {
    runId: string;
    toolCallId: string;
    reason?: string;
  }) => Promise<AgentRun>;
  /** Deny a waiting tool call. */
  deny: (args: {
    runId: string;
    toolCallId: string;
    reason?: string;
  }) => Promise<AgentRun>;
  /** Load older persisted messages. */
  loadOlder: (numItems?: number) => void;
  /** Reset local run-event buffers. */
  reset: () => void;
};

/**
 * Subscribe to an Agent conversation scope.
 *
 * @remarks
 * `useAgent` keeps Stream internal to Agent users. It uses Convex pagination for
 * persisted messages/runs and Stream buffer sets for live run-event replay.
 * Apps still own the public Convex functions so they can authorize by case,
 * organization, route, or any other app resource.
 *
 * @typeParam Args - Stable app-owned scope arguments.
 * @typeParam SendArgs - Public send mutation arguments.
 * @param functions - App-owned Convex function references.
 * @param args - Stable scope args passed to every app function.
 * @param options - Pagination and stream-buffer options.
 * @returns Agent product state and mutations for the scope.
 *
 * @public
 */
export function useAgent<
  Args extends AgentBaseArgs,
  SendArgs extends AgentBaseArgs,
>(
  functions: AgentScope<Args, SendArgs>,
  args: Args,
  options: UseAgentOptions = {},
): UseAgentResult<Args, SendArgs> {
  const initialNumMessages = options.initialNumMessages ?? 50;
  const initialNumRuns = options.initialNumRuns ?? 20;
  const initialNumEvents = options.initialNumEvents ?? 128;
  const messagesPage = usePaginatedQuery(
    functions.listMessages as PaginatedQueryReference,
    args,
    { initialNumItems: initialNumMessages },
  );
  const runsPage = usePaginatedQuery(
    functions.listRuns as PaginatedQueryReference,
    args,
    { initialNumItems: initialNumRuns },
  );
  const messages = messagesPage.results as AgentMessageDoc[];
  const runs = runsPage.results as AgentRun[];
  const activeRuns = useMemo(
    () => runs.filter((run) => !isTerminal(run.status)),
    [runs],
  );
  const activeRun = activeRuns[0] ?? runs[0] ?? null;
  const bufferedRuns = useMemo(() => {
    const materializedMessageIds = new Set(messages.map((message) => message._id));
    return runs.filter(
      (run) => !isRunFullyMaterialized(run, materializedMessageIds),
    );
  }, [messages, runs]);
  const activeRunIds = useMemo(
    () => bufferedRuns.map((run) => run.runId),
    [bufferedRuns],
  );
  const buffers = useStreamBufferSet<string, AgentRunEvent>(activeRunIds, {
    initialNumItems: initialNumEvents,
  });
  const readRequests = buffers.readRequests;
  const mergeReads = buffers.mergeReads;
  const resetBuffers = buffers.reset;
  const getSnapshot = buffers.getSnapshot;
  const readArgs: AgentRunEventsBatchArgs<Args> | "skip" =
    activeRunIds.length === 0
      ? "skip"
      : {
          ...args,
          reads: readRequests.map((request) => ({
            runId: request.key,
            streamArgs: request.streamArgs,
          })),
        };
  const reads = useAgentQuery(
    functions.readRunEventsBatch,
    readArgs,
  );

  useEffect(() => {
    if (reads === undefined) return;
    const streamReads: KeyedStreamReadResult<string, AgentRunEvent>[] = reads.map(
      (read) => ({
        ...read,
        key: read.runId,
        status: read.streamStatus,
      }),
    );
    mergeReads(streamReads);
  }, [mergeReads, reads]);

  const runStates = useMemo(
    () => materializeRunStates(bufferedRuns, getSnapshot),
    [bufferedRuns, getSnapshot, buffers.snapshots],
  );
  const sendMutation = useAgentMutation(functions.send);
  const cancelMutation = useAgentMutation(functions.cancel);
  const approveMutation = useAgentMutation(functions.approveToolCall);
  const denyMutation = useAgentMutation(functions.denyToolCall);
  const send = useCallback(
    async (input: ScopedMutationArgs<Args, SendArgs>) => {
      return await sendMutation(scopedArgs(args, input) as SendArgs);
    },
    [args, sendMutation],
  );
  const cancel = useCallback(
    async (input: { runId: string; reason?: string }) => {
      return await cancelMutation({ ...args, ...input });
    },
    [args, cancelMutation],
  );
  const approve = useCallback(
    async (input: { runId: string; toolCallId: string; reason?: string }) => {
      return await approveMutation({ ...args, ...input });
    },
    [args, approveMutation],
  );
  const deny = useCallback(
    async (input: { runId: string; toolCallId: string; reason?: string }) => {
      return await denyMutation({ ...args, ...input });
    },
    [args, denyMutation],
  );
  const loadOlder = useCallback(
    (numItems: number = initialNumMessages) => messagesPage.loadMore(numItems),
    [initialNumMessages, messagesPage],
  );
  const reset = useCallback(() => resetBuffers(), [resetBuffers]);
  const approvals = useMemo(
    () =>
      [...runStates.entries()].flatMap(([runId, state]) =>
        state.approvals.map((approval) => ({
          toolCallId: approval.toolCallId,
          runId: approval.runId ?? runId,
          name: approval.name ?? "",
          input: approval.input ?? null,
          status: approval.status,
          approvalId: approval.approvalId,
          approved: approval.approved,
          reason: approval.reason,
          output: approval.output,
          error: approval.error,
          requestedAt: approval.requestedAt,
          resolvedAt: approval.resolvedAt,
        })),
      ),
    [runStates],
  );
  const usageByRun = useMemo(() => {
    const values = new Map<string, AgentUsage>();
    for (const run of runs) if (run.usage) values.set(run.runId, run.usage);
    for (const [runId, state] of runStates) {
      if (state.usage) values.set(runId, state.usage);
    }
    return values;
  }, [runStates, runs]);
  const usage = activeRun ? usageByRun.get(activeRun.runId) : undefined;
  const usageTotal = useMemo(() => sumUsage(usageByRun.values()), [usageByRun]);
  const outputByRun = useMemo(() => {
    const values = new Map<string, Value>();
    for (const run of runs) if (run.output !== undefined) values.set(run.runId, run.output);
    for (const [runId, state] of runStates) {
      if (state.output !== undefined) values.set(runId, state.output);
    }
    return values;
  }, [runStates, runs]);
  const output = activeRun ? outputByRun.get(activeRun.runId) : undefined;
  const timeline = useMemo(
    () => buildAgentTimeline(messages, bufferedRuns, buffers.snapshots),
    [bufferedRuns, buffers.snapshots, messages],
  );

  return {
    timeline,
    messages,
    runs,
    activeRun,
    activeRuns,
    approvals,
    usage,
    usageTotal,
    output,
    status: getStatus(messagesPage.status, runsPage.status, activeRuns, runStates),
    send,
    cancel,
    approve,
    deny,
    loadOlder,
    reset,
  };
}

/**
 * Materialize one run from a Stream snapshot.
 *
 * @remarks
 * This lower-level hook is useful for adapters and diagnostics that already
 * have a stream snapshot and want Agent-specific state.
 *
 * @public
 */
export function useAgentRun(
  run: AgentRun | null | undefined,
  snapshot: StreamSnapshot<AgentRunEvent> | null | undefined,
): AgentRunState {
  return useMemo(() => materializeRun(run, snapshot), [run, snapshot]);
}

function materializeRunStates(
  runs: readonly AgentRun[],
  getSnapshot: UseStreamBufferSetResult<string, AgentRunEvent>["getSnapshot"],
) {
  const states = new Map<string, AgentRunState>();
  for (const run of runs) {
    states.set(run.runId, materializeRun(run, getSnapshot(run.runId)));
  }
  return states;
}

function useAgentQuery<Args extends AgentBaseArgs, Result>(
  query: FunctionReference<"query", "public", Args, Result>,
  args: Args | "skip",
): Result | undefined {
  return useQuery(
    query as FunctionReference<"query">,
    args as never,
  ) as Result | undefined;
}

function useAgentMutation<Args extends AgentBaseArgs, Result>(
  mutation: FunctionReference<"mutation", "public", Args, Result>,
): MutationRunner<Args, Result> {
  const run = useMutation(mutation);
  return useCallback(
    (args: Args) =>
      run(
        ...([args] as OptionalRestArgs<
          FunctionReference<"mutation", "public", Args, Result>
        >)
      ),
    [run],
  );
}

function scopedArgs<
  ScopeArgs extends AgentBaseArgs,
  MutationArgs extends AgentBaseArgs,
>(
  args: ScopeArgs,
  input: ScopedMutationArgs<ScopeArgs, MutationArgs>,
): MutationArgs {
  return { ...args, ...input } as unknown as MutationArgs;
}

function getStatus(
  messageStatus: string,
  runStatus: string,
  activeRuns: readonly AgentRun[],
  states: ReadonlyMap<string, AgentRunState>,
): UseAgentResult["status"] {
  if (messageStatus === "LoadingFirstPage" || runStatus === "LoadingFirstPage") {
    return "loading";
  }
  if ([...states.values()].some((state) => state.error)) {
    return "error";
  }
  if (activeRuns.some((run) => run.status === "waiting")) {
    return "waiting";
  }
  if (activeRuns.length > 0) {
    return "running";
  }
  return "idle";
}

function sumUsage(usages: Iterable<AgentUsage>) {
  let total: AgentUsage | undefined;
  for (const usage of usages) {
    total = {
      inputTokens: addOptional(total?.inputTokens, usage.inputTokens),
      outputTokens: addOptional(total?.outputTokens, usage.outputTokens),
      totalTokens: addOptional(total?.totalTokens, usage.totalTokens),
      tokenDetails: sumTokenDetails(total?.tokenDetails, usage.tokenDetails),
    };
  }
  return total;
}

function addOptional(left: number | undefined, right: number | undefined) {
  return left === undefined && right === undefined
    ? undefined
    : (left ?? 0) + (right ?? 0);
}

function sumTokenDetails(
  left: AgentUsage["tokenDetails"] | undefined,
  right: AgentUsage["tokenDetails"] | undefined,
) {
  const input = sumUsageDetails(left?.input, right?.input);
  const output = sumUsageDetails(left?.output, right?.output);
  return input === undefined && output === undefined
    ? undefined
    : { input, output };
}

function sumUsageDetails(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
) {
  if (left === undefined && right === undefined) return undefined;
  const total = { ...(left ?? {}) };
  for (const [key, value] of Object.entries(right ?? {})) {
    total[key] = (total[key] ?? 0) + value;
  }
  return total;
}
