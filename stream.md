# Agent Runs, HTTP, and Workflow Design

## Summary

Agent is becoming a Convex-native primitive for durable agent systems. The
core public model centers on runs, not AI SDK calls, HTTP wrappers, or
workflow wrappers.

`@convex-dev/stream` is the event-log substrate. Agent uses it internally
for ordered run events and HTTP serving, while Agent users think in terms
of threads, messages, runs, tool calls, usage, output, and approvals.

The new API center is:

```ts
agent.threads.create(ctx, args);
agent.threads.get(ctx, args);
agent.threads.list(ctx, args);
agent.threads.update(ctx, args);

agent.messages.save(ctx, args);
agent.messages.list(ctx, args);

agent.runs.start(ctx, args);
agent.runs.execute(ctx, args);
agent.runs.send(ctx, args);
agent.runs.cancel(ctx, args);
agent.runs.get(ctx, args);
agent.runs.list(ctx, args);
agent.runs.link(ctx, args);

agent.tools.list(ctx, args);
agent.tools.approve(ctx, args);
agent.tools.deny(ctx, args);

agent.events.read(ctx, args);
agent.events.readBatch(ctx, args);

agent.http(ctx, request, args);
```

Adapters map model- or framework-specific protocols onto this run model, but
they should not define the core API.

## Decisions

| Area | Decision |
| --- | --- |
| Core primitive | A run is the durable unit of agent work. |
| Main API | Use namespaced `threads`, `messages`, `runs`, `tools`, and `events` groups. |
| HTTP | Use a two-step core design: create or resume a run first, then serve that run's stream. |
| Workflow | Workflows stay app-owned through `WorkflowManager`; Agent does not define workflows. |
| Stream | Agent uses `@convex-dev/stream` internally; Stream stays data-type agnostic and invisible to normal Agent users. |
| Context | Retrieval, memory, auth, billing, rate limits, and other app systems compose through explicit app code. |
| Adapters | Vercel, TanStack, and other provider/framework adapters translate their protocols onto Agent runs without changing core. |

Do not introduce:

- Agent-owned workflow definition wrappers
- Agent-owned workflow action wrappers
- public `format` switches in Agent core
- text-specific stream primitives such as `defineTextStream`
- Agent-owned RAG wrappers, embedding tables, memory tables, or playground auth tables
- standalone helper families for billing, usage, or structured output

## Lifecycle

Use one lifecycle vocabulary for runs, tool calls, and Agent-owned stream state:

```ts
type AgentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "success"
  | "failed"
  | "canceled";
```

Approval is not a status. Approval is why a run or tool call is waiting:

```ts
type Waiting = {
  reason: "approval";
  toolCallIds: string[];
};
```

## Core Run Model

A run ties together prompt persistence, model/tool execution, streamed
events, workflow orchestration, and final messages.

```ts
type AgentRun = {
  runId: string;
  threadId: string;
  userId?: string;
  agentName: string;

  messageId?: string;
  resultMessageIds?: string[];

  streamId: string;
  workflowId?: string;
  key?: string;

  status: AgentStatus;
  waiting?: Waiting;
  error?: AgentError;
  usage?: AgentUsage;
  output?: Value;

  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
};

type AgentError = {
  code: string;
  message: string;
};
```

`key` is app-owned idempotency for creating or reusing the logical run. Examples
include `client-message:${clientMessageId}`, `http:${requestId}`, or
`workflow:${jobId}`.

## Core API

### `agent.runs.send`

Convenience path for normal users. It saves the prompt, starts a run, executes
the run immediately, and returns durable IDs.

```ts
const result = await supportAgent.runs.send(ctx, {
  threadId,
  userId,
  prompt: "Can you check my invoice?",
});
```

Return shape:

```ts
type SendResult = {
  threadId: string;
  messageId: string;
  runId: string;
  streamId: string;
  status: AgentStatus;
};
```

`send` is the replacement teaching surface for simple chat-like flows. It can
delegate internally to `start` and `execute`.

### `agent.runs.start`

Durable intent only. It saves or reuses the prompt message, creates or reuses a
run, creates a run-owned stream, and returns a `pending` run.
It does not call the model.

```ts
const run = await supportAgent.runs.start(ctx, {
  threadId,
  userId,
  prompt: "Can you check my invoice?",
  key: `client-message:${clientMessageId}`,
});
```

The public name `start` is reclaimed for durable runs. Low-level model
preparation belongs behind `execute` or adapter internals.

### `agent.runs.execute`

Action-only. It advances an existing run by loading context, calling the
model, running tools, appending run stream events, saving final messages, and
moving the run to a terminal or waiting state.

```ts
await supportAgent.runs.execute(ctx, {
  runId: run.runId,
  tools: { lookupAccount, refundPayment },
});
```

`execute` should be idempotent at the run boundary. Retrying an already
successful, failed, canceled, or waiting run should not duplicate prompt
messages or create a second logical stream.

### `agent.runs.cancel`

Cancels a run and its Agent-owned stream state. If the run is linked to an
external workflow, app code can also cancel that workflow.

```ts
await supportAgent.runs.cancel(ctx, {
  runId,
  reason: "User canceled",
});
```

### `agent.runs.get` and `agent.runs.list`

Read durable run state.

```ts
const run = await supportAgent.runs.get(ctx, { runId });

const page = await supportAgent.runs.list(ctx, {
  threadId,
  statuses: ["pending", "running", "waiting"],
  paginationOpts,
});
```

### `agent.runs.link`

Records an external orchestration ID, such as a workflow ID, on the run.
Agent should not own workflow execution semantics.

```ts
await supportAgent.runs.link(ctx, {
  runId: run.runId,
  workflowId,
});
```

### `agent.http`

Serves a run-owned stream through `@convex-dev/stream.http`.

```ts
return await supportAgent.http(ctx, request, {
  runId: run.runId,
});
```

`http` should load the run, require `streamId`, and delegate stream serving to
the Agent stream definition. App code owns authentication, authorization, CORS,
and route shape.

Useful response headers:

```txt
X-Agent-Run-Id
X-Agent-Thread-Id
X-Agent-Message-Id
X-Stream-Id
```

## Simple Action DX

For ordinary Agent users, the smallest useful path is still one action:

```ts
export const send = action({
  args: {
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await assertCanWriteThread(ctx, args.threadId, userId);

    return await supportAgent.runs.send(ctx, {
      threadId: args.threadId,
      userId,
      prompt: args.prompt,
    });
  },
});
```

This is intentionally not a Vercel or TanStack API. It is a Convex action that
returns durable Agent IDs. Adapters can provide framework-native ergonomics on
top of this same run boundary.

## System Builder DX

Systems that need explicit retry, queueing, HTTP streaming, workflows, or
custom orchestration use the split lifecycle:

```ts
const run = await supportAgent.runs.start(ctx, {
  threadId,
  userId,
  prompt,
  key: `client-message:${clientMessageId}`,
});

await supportAgent.runs.execute(ctx, {
  runId: run.runId,
  tools,
});
```

The split makes durable boundaries visible:

- `start` is mutation-friendly and idempotent.
- `execute` is action-only and retryable.
- event streams, usage, output, tool state, and final messages are correlated by `runId`.

## Context Composition

Agent core should load recent thread messages itself, then let apps attach any
extra context explicitly. Retrieval, memory, billing, rate limiting, auth, and
tenant policy are app-owned systems. They compose with Agent through normal
Convex functions instead of hidden Agent storage or wrapper DSLs.

The core interface is deliberately small:

```ts
type AgentContextBlock = {
  type: "text";
  name?: string;
  text: string;
  metadata?: Value;
};

type AgentContextLoader = (
  ctx: RunExecutionCtx,
  args: {
    run: AgentRun;
    promptMessage?: AgentMessageDoc;
    recentMessages: AgentMessageDoc[];
  },
) => Promise<AgentContextBlock[]>;
```

`execute` accepts loaders in order. Agent passes both the recent thread
messages and app-loaded context blocks to the model request:

```ts
await supportAgent.runs.execute(ctx, {
  runId: run.runId,
  recentMessages: 20,
  context: [loadSupportContext, loadBillingContext],
  tools,
});
```

RAG is one app-owned context loader, not a built-in Agent subsystem:

```ts
const loadSupportContext: AgentContextLoader = async (ctx, { run }) => {
  const results = await rag.search(ctx, {
    namespace: run.userId,
    query: "current support issue",
    limit: 5,
  });

  return [
    {
      type: "text",
      name: "support-rag",
      text: results.text,
      metadata: { source: "rag" },
    },
  ];
};
```

This means Agent no longer owns semantic retrieval schema. There are no Agent
embedding tables, memory tables, message embedding IDs, or playground API-key
tables in core. Existing deployments from the old schema need a reset or an
explicit migration before running this clean-break core.

## Workflow DX

Agent should not wrap `WorkflowManager`. There should be no Agent-owned workflow
DSL.

Apps define normal Convex internal actions:

```ts
export const executeSupportRun = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    await supportAgent.runs.execute(ctx, {
      runId,
      tools: { lookupAccount, refundPayment },
    });
  },
});
```

Apps define normal workflows:

```ts
const workflow = new WorkflowManager(components.workflow);

export const supportWorkflow = workflow.define({
  args: { runId: v.string() },
  handler: async (step, { runId }): Promise<void> => {
    await step.runAction(
      internal.support.executeSupportRun,
      { runId },
      { retry: true },
    );
  },
});
```

Apps start workflows explicitly:

```ts
export const sendWithWorkflow = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    clientMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await assertCanWriteThread(ctx, args.threadId, userId);

    const run = await supportAgent.runs.start(ctx, {
      threadId: args.threadId,
      userId,
      prompt: args.prompt,
      key: `client-message:${args.clientMessageId}`,
    });

    const workflowId = await workflow.start(
      ctx,
      internal.support.supportWorkflow,
      { runId: run.runId },
    );

    await supportAgent.runs.link(ctx, {
      runId: run.runId,
      workflowId,
    });

    return { ...run, workflowId };
  },
});
```

The workflow journal stores `runId`, not prompt text, model payloads, large
message arrays, or tool results.

## HTTP DX

HTTP should use the same run primitives as workflows and subscriptions. The
core design is intentionally two-step:

1. Create or resume a durable run.
2. Serve the run-owned stream.

This matches `@convex-dev/stream`: `stream.http` serves an existing durable
stream. It also keeps auth, run creation, model execution, and stream
serving as separate Convex operations.

### Step 1: Create Or Resume A Run

The app owns the public mutation. It authenticates, authorizes the thread,
creates or reuses the logical run, schedules execution, and returns durable IDs
to the client.

```ts
export const send = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    clientMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await assertCanWriteThread(ctx, args.threadId, userId);

    const run = await supportAgent.runs.start(ctx, {
      threadId: args.threadId,
      userId,
      prompt: args.prompt,
      key: `client-message:${args.clientMessageId}`,
    });

    await ctx.scheduler.runAfter(0, internal.support.executeSupportRun, {
      runId: run.runId,
    });

    return run;
  },
});
```

Return shape:

```ts
type StartResult = {
  threadId: string;
  messageId: string;
  runId: string;
  streamId: string;
  status: "pending";
};
```

### Step 2: Serve The Run Stream

The app owns the HTTP route. It authenticates the request, authorizes access to
the run, and delegates stream serving to Agent.

```ts
http.route({
  path: "/runs/stream",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const userId = await requireUserIdFromRequest(ctx, request);
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");
    if (!runId) {
      return new Response("Missing runId", { status: 400 });
    }

    await assertCanReadRun(ctx, runId, userId);

    const response = await supportAgent.http(ctx, request, { runId });
    response.headers.set("Access-Control-Allow-Origin", "https://app.example.com");
    response.headers.set(
      "Access-Control-Expose-Headers",
      "X-Agent-Run-Id, X-Agent-Thread-Id, X-Agent-Message-Id, X-Stream-Id",
    );
    return response;
  }),
});
```

Client code can use the run IDs returned from `send` to connect to the durable
stream:

```ts
const run = await convex.mutation(api.chat.send, {
  threadId,
  prompt,
  clientMessageId,
});

handleHttpStream<AgentStreamEvent>({
  url: `${siteUrl}/runs/stream?runId=${encodeURIComponent(run.runId)}`,
  cursor: null,
  headers: { Authorization: `Bearer ${apiKey}` },
  onEvents(events) {
    // Render live output.
  },
});
```

If the stream route opens before model output exists, it should wait and
poll through the Stream HTTP primitive until events or terminal status arrive.
That is expected and is part of the reason the stream exists before execution.

### HTTP From A Single Route

A single app HTTP route can still do both steps internally if the app wants one
network entrypoint. It should still follow the same model: create the run,
schedule execution, then serve the already-created stream.

```ts
http.route({
  path: "/chat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const userId = await requireUserIdFromRequest(ctx, request);
    const body = await request.json();

    const threadId = await authorizeThread(ctx, body.threadId, userId);

    const run = await supportAgent.runs.start(ctx, {
      threadId,
      userId,
      prompt: body.prompt,
      key: `http:${body.clientMessageId}`,
    });

    await ctx.scheduler.runAfter(0, internal.support.executeSupportRun, {
      runId: run.runId,
    });

    return await supportAgent.http(ctx, request, {
      runId: run.runId,
    });
  }),
});
```

This is still the two-step model semantically. The route is just combining the
public mutation and stream route into one HTTP handler.

### Why Two-Step Is Core

Two-step is the core Agent design because:

- it matches `@convex-dev/stream.http`, which serves existing streams
- it separates authorization and run creation from long-running model work
- it works for HTTP, workflows, Convex subscriptions, queues, retries, and mobile clients
- it makes `runId` the stable correlation primitive everywhere
- it avoids making Agent core depend on POST-body chat protocols
- it avoids one-off HTTP helper names and format switches in the core API

One-request POST streaming can still exist later as a wrapper or convenience
API. It should not be the Agent core contract.

## Tool Approval

Tool calls are durable operational state tied to a run. The run event stream is
still the source of event history, but normal approval/list control paths read a
bounded internal projection so long-running text streams do not require replaying
thousands of unrelated events.

```ts
type ToolCall = {
  toolCallId: string;
  runId: string;
  name: string;
  input: Value;
  status: "pending" | "waiting" | "success" | "failed" | "canceled";
  approvalId?: string;
  approved?: boolean;
  reason?: string;
  output?: Value;
  error?: AgentError;
  requestedAt: number;
  resolvedAt?: number;
};
```

Approval APIs are run-scoped:

```ts
const pending = await supportAgent.tools.list(ctx, {
  runId,
});

const waiting = pending.filter((toolCall) => toolCall.status === "waiting");

await supportAgent.tools.approve(ctx, {
  runId,
  toolCallId,
  reason,
});

await supportAgent.tools.deny(ctx, {
  runId,
  toolCallId,
  reason,
});
```

When approval is required:

- the run moves to `waiting`
- the projected tool-call row moves to `waiting`
- the run stream emits Agent-owned approval request/response events
- a later `runs.execute` can resume from the same `runId`

## Tool Adapter Boundaries

Agent tools are intentionally defined with Convex validators and Agent-owned
execution semantics:

```ts
import { v } from "convex/values";
import { defineTool } from "@convex-dev/agent";

export const refundPayment = defineTool({
  description: "Refund a customer payment.",
  input: v.object({
    paymentId: v.string(),
    amount: v.number(),
  }),
  output: v.object({
    refunded: v.string(),
    amount: v.number(),
  }),
  needsApproval: true,
  execute: async (input, context) => {
    if (context.signal?.aborted) {
      throw new Error("Canceled");
    }
    return { refunded: input.paymentId, amount: input.amount };
  },
});
```

The core tool shape is not a Vercel AI SDK `tool(...)` and not a TanStack AI
`toolDefinition(...)`. The common denominator is:

- a tool name from the registry key
- optional description
- typed input schema
- optional typed output schema
- optional approval policy
- app-owned execution

Adapters translate that shape internally:

- `@convex-dev/agent/vercel` maps Agent tools to AI SDK schema-only tool
  definitions for `streamText`; Agent still validates, approves, executes, and
  persists tool results. Tool output validators stay in Agent core because AI SDK
  provider tool definitions primarily need model-facing input schemas.
- A TanStack adapter can map the same Agent tool to `toolDefinition({ name,
  description, inputSchema, outputSchema, needsApproval })` while keeping TanStack's
  client/server approval protocol at the adapter boundary.

This keeps provider/framework-specific expectations out of Agent core while
still letting users keep their preferred framework names in adapter entrypoints.

```ts
import { openai } from "@ai-sdk/openai";
import { defineModel } from "@convex-dev/agent/vercel";
import { Agent } from "@convex-dev/agent";

export const supportAgent = new Agent(components.agent, {
  name: "Support Agent",
  model: defineModel({
    model: openai("gpt-4.1-mini"),
    temperature: 0.2,
  }),
  tools: { refundPayment },
});
```

## Stream Substrate

Agent should use `@convex-dev/stream` as an internal durable event substrate.
The Stream package already owns the generic primitives:

- `defineStream`
- typed metadata
- lifecycle statuses: `pending`, `running`, `success`, `failed`, `canceled`
- `get` and `getMany` for stream-head lookup
- `getOrCreate` for keyed stream creation
- `appendTail` for idempotent tail appends
- cursor and `startIndex` reads
- `stream.http` for serving an existing durable stream
- `handleHttpStream` for browser or wrapper clients

Stream is data-type agnostic. Agent defines Agent-specific event payloads:

```ts
type AgentStreamEvent =
  | { type: "text.delta"; text: string }
  | { type: "reasoning.delta"; text: string; signature?: string }
  | { type: "source"; source: Source }
  | { type: "file"; file: { fileId?: string; url?: string; data?: string | ArrayBuffer; mediaType: string; filename?: string } }
  | { type: "tool.call"; toolCallId: string; name: string; input: Value }
  | { type: "tool.result"; toolCallId: string; name?: string; output?: Value; error?: AgentError }
  | { type: "approval.request"; approvalId: string; toolCallId: string; name: string; input: Value }
  | { type: "approval.response"; approvalId: string; toolCallId: string; approved: boolean; reason?: string }
  | { type: "usage"; usage: AgentUsage }
  | { type: "message"; message: AgentMessageInput }
  | { type: "error"; error: AgentError }
  | { type: "done"; usage?: AgentUsage };
```

`stream.http` serves an existing stream. That means Agent owns run creation and
execution scheduling before HTTP serving begins. Agent users interact with run
IDs and Agent APIs; Stream remains an internal event substrate unless the app is
deliberately serving the run stream over HTTP.

Do not add Agent-specific or text-specific primitives to Stream unless this
run-centered design reveals a real generic gap.

## Adapter Direction

Provider and UI framework support should be adapters over the run-centered core,
not hidden legacy exports inside the core package. Core docs should teach:

```ts
agent.runs.send(...);
agent.runs.start(...);
agent.runs.execute(...);
agent.http(...);
```

`@convex-dev/agent/vercel` is the first adapter. It exposes AI SDK model and
React transport compatibility without moving `UIMessage`, `ModelMessage`, or AI
SDK tool execution semantics into Agent core. TanStack, LangChain, Mastra, and
other adapters should follow the same rule: translate their protocol at the
adapter boundary, then let Agent own durable runs, messages, tools, approvals,
usage, output, cancellation, and events.

## PR 259 Reuse

PR 259 is useful prior art for HTTP behavior, not the final API contract.

Keep:

- app-owned authorization
- default-deny handling for caller-supplied `threadId`
- malformed JSON handling
- request abort handling
- response headers that correlate HTTP output with persisted state
- client dedupe between origin-session HTTP output and subscribed persisted state

Do not copy:

- `asHttpAction` as the core abstraction
- public `format` switches
- text/UI-message protocol naming in Agent core
- `saveStreamDeltas` as the public HTTP persistence model

## Current Status

Implemented in the hard-cut branch:

1. Durable threads, messages, runs, and run lifecycle APIs.
2. `agent.runs.start` for durable run intent.
3. `agent.runs.execute` over Agent-native model events.
4. `agent.runs.send` as the simple `start` plus `execute` path.
5. Ordered app context loaders passed to `runs.execute`.
6. `agent.runs.cancel` with durable terminal-state enforcement.
7. Usage and structured output persisted on `AgentRun`.
8. Bounded internal tool-call projections for approval control paths.
9. `agent.events.read` and `agent.events.readBatch` for hooks, adapters, and devtools.
10. `agent.http` over the run-owned Stream log.
11. Normal `WorkflowManager` composition through internal actions.

Still future work:

1. Final public API/JSDoc review before opening the core PR.
2. React product hook hardening on top of Stream buffer primitives.
3. Vercel adapter hardening and TanStack adapter design over the same core run model.
4. Svelte hooks after the TypeScript/React primitives settle.
5. Production docs for auth, RAG, files, rate limits, billing, and workflows.
