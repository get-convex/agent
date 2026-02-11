# Migration Guide: v0.3.x to v0.6.0 (AI SDK v6)

This guide helps you upgrade from @convex-dev/agent v0.3.x to v0.6.0.

## Step 1: Update dependencies

Update all AI SDK packages **together** to avoid peer dependency conflicts:

```bash
npm install @convex-dev/agent@^0.6.0 ai@^6.0.35 @ai-sdk/provider-utils@^4.0.6
```

### Official AI SDK providers

Update your AI SDK provider packages to v3.x:
```bash
# For OpenAI
npm install @ai-sdk/openai@^3.0.10

# For Anthropic
npm install @ai-sdk/anthropic@^3.0.13

# For Groq
npm install @ai-sdk/groq@^3.0.8

# For Google (Gemini)
npm install @ai-sdk/google@^3.0.8
```

### Third-party providers

Third-party providers also need updates to be compatible with AI SDK v6:

```bash
# For OpenRouter
npm install @openrouter/ai-sdk-provider@^2.0.0

# For other providers, check their documentation for AI SDK v6 compatibility
```

### Handling dependency conflicts

If you see peer dependency warnings or errors, try updating all packages at once:

```bash
npm install @convex-dev/agent@^0.6.0 ai@^6.0.35 @ai-sdk/openai@^3.0.10 @openrouter/ai-sdk-provider@^2.0.0
```

If you still have conflicts, you can use `--force` as a last resort:

```bash
npm install @convex-dev/agent@^0.6.0 --force
```

> **Note**: Using `--force` can lead to inconsistent dependency trees. After using it, verify your app works correctly and consider running `npm dedupe` to clean up.

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

### Peer dependency conflicts

If you see errors like:
```
npm error ERESOLVE unable to resolve dependency tree
npm error peer ai@"^5.0.0" from @openrouter/ai-sdk-provider@1.0.3
```

This means a third-party provider needs updating. Common solutions:

1. **Update the provider** to a version compatible with AI SDK v6
2. **Check npm** for the latest version: `npm view @openrouter/ai-sdk-provider versions`
3. **Use `--force`** if a compatible version isn't available yet (temporary workaround)

### Third-party provider compatibility

| Provider | AI SDK v5 (ai@5.x) | AI SDK v6 (ai@6.x) |
|----------|-------------------|-------------------|
| @openrouter/ai-sdk-provider | v1.x | v2.x |
| @ai-sdk/openai | v1.x-v2.x | v3.x |
| @ai-sdk/anthropic | v1.x-v2.x | v3.x |
| @ai-sdk/groq | v1.x-v2.x | v3.x |
| @ai-sdk/google | v1.x-v2.x | v3.x |

## More Information

- [AI SDK v6 Migration Guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
- [Convex Agent Documentation](https://docs.convex.dev/agents)
