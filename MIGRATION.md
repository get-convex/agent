# Migration Guide: v0.3.x to v0.6.0 (AI SDK v6)

This guide helps you upgrade from @convex-dev/agent v0.3.x to v0.6.0.

## Step 1: Update dependencies

```bash
npm install @convex-dev/agent@^0.6.0 ai@^6.0.35 @ai-sdk/provider-utils@^4.0.6
```

Update your AI SDK provider packages to v3.x:
```bash
# For OpenAI
npm install @ai-sdk/openai@^3.0.10

# For Anthropic
npm install @ai-sdk/anthropic@^3.0.13

# For Groq
npm install @ai-sdk/groq@^3.0.8
```

## Step 2: Update tool definitions

Replace `parameters` with `inputSchema`:

```typescript
// Before (v5)
const myTool = createTool({
  description: "My tool",
  parameters: z.object({ query: z.string() }),
  execute: async (ctx, args) => { ... }
})

// After (v6)
const myTool = createTool({
  description: "My tool",
  inputSchema: z.object({ query: z.string() }),
  execute: async (ctx, input, options) => { ... }
})
```

## Step 3: Update Agent config (if using embeddings)

```typescript
// Before
new Agent(components.agent, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small")
})

// After
new Agent(components.agent, {
  embeddingModel: openai.embedding("text-embedding-3-small")
})
```

## Step 4: Update maxSteps (optional)

```typescript
// Before
await agent.generateText(ctx, { threadId }, {
  prompt: "...",
  maxSteps: 5
})

// After (maxSteps still works, but stopWhen is preferred)
import { stepCountIs } from "ai"
await agent.generateText(ctx, { threadId }, {
  prompt: "...",
  stopWhen: stepCountIs(5)
})
```

## Step 5: Verify

```bash
npm run typecheck
npm test
```

## Common Issues

### EmbeddingModelV2 vs EmbeddingModelV3 type errors
Ensure all `@ai-sdk/*` packages are updated to v3.x. Older versions use AI SDK v5 types.

### Tool `args` vs `input`
AI SDK v6 renamed `args` to `input` in tool calls. The library maintains backwards compatibility, but you may see this in types.

### `mimeType` vs `mediaType`
AI SDK v6 renamed `mimeType` to `mediaType`. Backwards compatibility is maintained.

## More Information

- [AI SDK v6 Migration Guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
- [Convex Agent Documentation](https://docs.convex.dev/agents)
