# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

@convex-dev/agent is a TypeScript/NPM package that provides an AI Agent component for Convex. In v2 (this branch) Agent is a **Convex-native durable execution primitive**: it owns threads, messages, runs, tools, approvals, usage, structured output, cancellation, and run event streams. Run events are stored via `@convex-dev/stream` (an ordered event log served over HTTP).

Agent is deliberately unopinionated about product concerns. The **app composes** auth/session, file storage, RAG/context loading, rate limits, billing, workflows, and provider SDKs *outside* Agent — Agent core no longer imports AI SDK types and is provider-agnostic (the app supplies an `AgentModel`). See `example/convex/support/` for a full app-owned composition.

Documentation: [Convex Agent Docs](https://docs.convex.dev/agents)

## Commands

### Development
```bash
npm run dev          # Run backend + frontend + build watch concurrently
npm run build        # TypeScript build (tsc --project ./tsconfig.build.json)
npm run build:demo   # Build the example app (cd example && vite build)
```

### Testing
```bash
npm test             # Run tests with typecheck (vitest run --typecheck)
npm run test:watch   # Watch mode (vitest --typecheck)
```

### Code Quality
```bash
npm run lint         # ESLint
npm run typecheck    # Full TypeScript validation (package + example + example/convex)
```

## Architecture

### Source Structure (`/src`)

**Three-Layer Architecture:**
1. **Client** (`src/client/`) — Public API for consuming applications
   - `index.ts` — Main `Agent` class (namespaces: `threads`, `messages`, `runs`, `tool`, `events`, plus `http`)
   - `execution.ts` — Run execution: drives an `AgentModel`, records run events, materializes result messages, handles cancellation/approval
   - `runEvents.ts` — Run event reading/serving over the `@convex-dev/stream` HTTP protocol
   - `componentRefs.ts` — Typed references into the generated component API
   - `messageInput.ts` — Message input normalization

2. **Component** (`src/component/`) — Convex backend (runs on Convex servers)
   - `schema.ts` — Database schema (`threads`, `messages`, `runs`, `runToolCalls`)
   - `runs.ts` — Run lifecycle, tool-call projection, run event log
   - `messages.ts`, `threads.ts`, `users.ts` — Message/thread/user operations

3. **React** (`src/react/`) — React hooks for UI integration
   - `index.ts` — `useAgent` (primary surface) and `useAgentRun`
   - `timeline.ts` — Builds an `AgentTimelineItem[]` from realtime messages + run events

**Shared Files:**
- `validators.ts` — Convex validators (`vAgentMessage`, `vPublicRun`, `vAgentToolCall`, `vAgentStatus`, `vThreadDoc`, `paginationResultValidator`-shaped page results, etc.)

### Key Patterns

- **Durable runs** — `runs.start()` creates durable intent in a mutation; `runs.execute()` advances it in a scheduled/internal action. The browser calls a mutation; provider work stays server-side.
- **Run event streams over HTTP** — Streaming is NOT WebSocket deltas. Ordered run events are persisted via `@convex-dev/stream` and served through `agent.http(ctx, request, { runId })`; the React `useAgent` hook consumes them.
- **Provider-agnostic core** — Agent core emits/consumes Agent-owned events; the app provides an `AgentModel` (`defineAgentModel`) that yields those events from any provider.
- **App-owned composition** — auth, files, RAG/context, rate limits, billing, and workflows live in the app, not the component. Agent receives an already-authorized user/thread boundary.
- **Tool approval flow** — tools (`defineTool`) can require human approval via `needsApproval`; approval state is projected into bounded `runToolCalls` rows, resolved with `agent.tool.approve()` / `agent.tool.deny()`.

### Database Tables (Convex Component)

- **threads** — Conversations with optional `userId`, title, summary, status
- **messages** — Chat messages with order/stepOrder, status, the Agent-native `message` node, plus convenience `tool`/`text` fields and usage
- **runs** — Durable run records: lifecycle status, usage, structured `output`, result message IDs, cancellation, workflow/stream correlation, and an append-only `nextEventSequence`
- **runToolCalls** — Per-run tool-call projection (input/output/status/approval), so approval queries don't replay full event streams

## Convex-Specific Guidelines

Follow the rules in `.cursor/rules/convex_rules.mdc`:

- **Function syntax**: Always use new syntax with `args` and `returns` validators
- **Validators**: Use `v.null()` for null returns, `v.int64()` instead of deprecated `v.bigint()`
- **Indexes**: Include all fields in index name (e.g., `threadId_status_createdAt`)
- **Queries**: Use `withIndex` instead of `filter`; define indexes in schema
- **Internal functions**: Use `internalQuery`/`internalMutation`/`internalAction` for private functions
- **Actions**: Add `"use node";` for Node.js modules; actions cannot use `ctx.db`
- **Type safety**: Use `Id<'tableName'>` for document IDs, strict TypeScript

## Export Surfaces

- `@convex-dev/agent` — Main exports (`Agent` class, `defineTool`, `defineAgentModel`, context-loader types, validators)
- `@convex-dev/agent/react` — React hooks (`useAgent`, `useAgentRun`, `AgentTimelineItem`)
- `@convex-dev/agent/validators` — Convex validators for integration
- `@convex-dev/agent/convex.config` — Component config for `defineApp`
- `@convex-dev/agent/test` — Testing utilities

## V2 API Reference

v2 is a **breaking** redesign — the AI-SDK/UIMessage-centered API is gone. Core surfaces:

```ts
const supportAgent = new Agent(components.agent, {
  name: "Support Agent",
  model: supportModel,                 // an AgentModel (defineAgentModel)
  output: v.optional(v.object({ category: v.string(), confidence: v.number() })),
});

// Threads / messages
agent.threads.create | get | list | update
agent.messages.save | list

// Durable runs
agent.runs.start | send | execute | cancel | get | list | link

// Tools + approvals
agent.tool.list | approve | deny

// Run events
agent.events.read | readBatch
agent.http(ctx, request, { runId })    // serve run events over HTTP
```

**Durable run shape** (mutation starts intent, action advances it):
```ts
export const send = mutation({
  args: { threadId: v.string(), prompt: v.string(), clientKey: v.string() },
  handler: async (ctx, args) => {
    const run = await supportAgent.runs.start(ctx, {
      threadId: args.threadId,
      prompt: args.prompt,
      key: `client-message:${args.clientKey}`,
    });
    await ctx.scheduler.runAfter(0, internal.support.executeRun, { runId: run.runId });
    return run;
  },
});

export const executeRun = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    await supportAgent.runs.execute(ctx, { runId });
  },
});
```

**Provider-agnostic model** — the app yields Agent-owned events:
```ts
export const supportModel = defineAgentModel({
  async *execute(request) {
    yield { type: "text.delta", text: "Hello from Agent core." };
    yield { type: "usage", usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 } };
    yield { type: "done" };
  },
});
```

**Tools** are Agent-native; approval state is projected into bounded rows:
```ts
const refundPayment = defineTool({
  description: "Refund a customer payment.",
  input: v.object({ paymentId: v.string() }),
  needsApproval: true,
  execute: async (input, context) => {
    if (context.signal?.aborted) throw new Error("Canceled");
    return { refunded: input.paymentId };
  },
});

await supportAgent.tool.approve(ctx, { runId, toolCallId });
await supportAgent.tool.deny(ctx, { runId, toolCallId, reason: "Needs manager review." });
```

**React** — `useAgent` is the primary surface; the stream stays internal:
```tsx
const agent = useAgent(
  {
    listMessages: api.support.messages.list,
    listRuns: api.support.runs.list,
    readRunEventsBatch: api.support.runs.readEventsBatch,
    send: api.support.runs.sendMessage,
    cancel: api.support.runs.cancel,
    approveToolCall: api.support.tools.approve,
    denyToolCall: api.support.tools.deny,
  },
  { caseId },
  { initialNumMessages: 50 },
);
// agent.timeline, agent.status, agent.activeRun, agent.usage, agent.output, agent.approvals
await agent.send({ prompt: "Help me with this issue." });
```

**App-owned composition** — auth/files/RAG/rate-limits/billing/workflows live in the app. Agent receives an already-authorized user/thread boundary, keeps typed file references (without owning file tables), takes retrieval results as `AgentContextBlock[]` via context loaders passed to `runs.execute`, and records usage on the run for the app to turn into billing. See `example/convex/support/` for the reference implementation.
