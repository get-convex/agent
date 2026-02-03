# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

@convex-dev/agent is a TypeScript/NPM package that provides an AI Agent component for Convex. It enables building agentic AI applications with thread/message management, LLM integration via AI SDK, WebSocket streaming, tool calling, vector embeddings, and RAG.

Documentation: [Convex Agent Docs](https://docs.convex.dev/agents)

## Commands

### Development
```bash
npm run dev          # Run backend + frontend + build watch concurrently
npm run build        # TypeScript build (tsc --project ./tsconfig.build.json)
```

### Testing
```bash
npm test             # Run tests with typecheck (vitest run --typecheck)
npm run test:watch   # Watch mode (vitest --typecheck)
```

### Code Quality
```bash
npm run lint         # ESLint
npm run typecheck    # Full TypeScript validation including example/convex
```

## Architecture

### Source Structure (`/src`)

**Three-Layer Architecture:**
1. **Client** (`src/client/`) - Public API for consuming applications
   - `index.ts` - Main `Agent` class and exports
   - `start.ts` - `startGeneration()` core generation logic
   - `streaming.ts`, `search.ts`, `messages.ts`, `threads.ts` - Feature modules

2. **Component** (`src/component/`) - Convex backend (runs on Convex servers)
   - `schema.ts` - Database schema (threads, messages, streamingMessages, streamDeltas, memories, files)
   - `index.ts` - Main component implementation
   - Backend operations for messages, threads, streaming, vector search

3. **React** (`src/react/`) - React hooks for UI integration
   - `useThreadMessages.ts` - Paginated + streaming messages
   - `useUIMessages.ts` - UIMessage-first hook with metadata
   - `useSmoothText.ts` - Animated text rendering

**Shared Files:**
- `validators.ts` - Convex validators (vMessage, vMessageDoc, vThreadDoc, etc.)
- `UIMessages.ts` - UIMessage types and conversion utilities
- `mapping.ts` - Message serialization between ModelMessage and stored formats

### Key Patterns

- **Streaming via WebSocket deltas** - Not HTTP streaming. Delta compression with heartbeats.
- **Message-centric design** - All operations revolve around message persistence/retrieval
- **Component-based encapsulation** - Uses Convex Components pattern
- **Multi-user support** - Threads have optional `userId` for ownership

### Database Tables (Convex Component)

- **threads** - Conversations with userId, title, summary, status
- **messages** - Chat messages with order, stepOrder, status, metadata
- **streamingMessages** - Real-time streaming state (streaming/finished/aborted)
- **streamDeltas** - Stream chunks with start/end ranges
- **memories** - User/thread memories for RAG with embedding references

## Convex-Specific Guidelines

Follow the rules in `.cursor/rules/convex_rules.mdc`:

- **Function syntax**: Always use new syntax with `args` and `returns` validators
- **Validators**: Use `v.null()` for null returns, `v.int64()` instead of deprecated `v.bigint()`
- **Indexes**: Include all fields in index name (e.g., `by_threadId_and_status`)
- **Queries**: Use `withIndex` instead of `filter`; define indexes in schema
- **Internal functions**: Use `internalQuery`/`internalMutation`/`internalAction` for private functions
- **Actions**: Add `"use node";` for Node.js modules; actions cannot use `ctx.db`
- **Type safety**: Use `Id<'tableName'>` for document IDs, strict TypeScript

## Export Surfaces

- `@convex-dev/agent` - Main exports (Agent class, types, validators, tools)
- `@convex-dev/agent/react` - React hooks (useThreadMessages, useUIMessages, etc.)
- `@convex-dev/agent/validators` - Convex validators for integration
- `@convex-dev/agent/test` - Testing utilities

## Upgrading to v0.6.0 (AI SDK v6)

When helping users upgrade from @convex-dev/agent v0.3.x to v0.6.0, follow these steps:

### Step 1: Update dependencies in package.json

```bash
npm install @convex-dev/agent@^0.6.0 ai@^6.0.35 @ai-sdk/provider-utils@^4.0.6
```

Also update any AI SDK provider packages:
```bash
npm install @ai-sdk/openai@^3.0.10 @ai-sdk/anthropic@^3.0.13
```

### Step 2: Update tool definitions

Replace `parameters` with `inputSchema`:

```typescript
// Before (v5)
const myTool = createTool({
  description: "...",
  parameters: z.object({ query: z.string() }),
  execute: async (ctx, args) => { ... }
})

// After (v6)
const myTool = createTool({
  description: "...",
  inputSchema: z.object({ query: z.string() }),
  execute: async (ctx, input, options) => { ... }
})
```

### Step 3: Update maxSteps usage (if applicable)

```typescript
// Before (v5)
await agent.generateText(ctx, { threadId }, {
  prompt: "...",
  maxSteps: 5
})

// After (v6) - maxSteps still works but stopWhen is preferred
import { stepCountIs } from "ai"
await agent.generateText(ctx, { threadId }, {
  prompt: "...",
  stopWhen: stepCountIs(5)
})
```

### Step 4: Update embedding model config (optional)

```typescript
// Before
new Agent(components.agent, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small")
})

// After (textEmbeddingModel still works but embeddingModel is preferred)
new Agent(components.agent, {
  embeddingModel: openai.embedding("text-embedding-3-small")
})
```

### Step 5: Verify the upgrade

```bash
npm run typecheck
npm run lint
npm test
```

### Common issues

- **EmbeddingModelV2 vs V3 errors**: Ensure all @ai-sdk/* packages are updated to v3.x
- **Tool input/args**: v6 uses `input` instead of `args` in tool calls (backwards compat maintained)
- **mimeType vs mediaType**: v6 uses `mediaType` (backwards compat maintained)
