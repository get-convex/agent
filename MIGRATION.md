# Migration Guide: v0.6.x to v0.7.0 (AI SDK v7)

`@convex-dev/agent` v0.7 uses AI SDK 7 at runtime. Existing messages saved by
v0.6 remain readable; applications must update their AI SDK runtime and
provider packages together.

## 1. Update Node.js and dependencies

Agent v0.7 requires Node.js 22 or newer.

```bash
pnpm add @convex-dev/agent@^0.7.0 ai@^7.0.0 \
  @ai-sdk/provider@^4.0.0 @ai-sdk/provider-utils@^5.0.0
```

Update official provider packages to v4:

```bash
pnpm add @ai-sdk/openai@^4.0.0 @ai-sdk/anthropic@^4.0.0 \
  @ai-sdk/google@^4.0.0 @ai-sdk/groq@^4.0.0
```

Update third-party providers to releases that support AI SDK 7. If your
application uses `@convex-dev/rag` with Agent, use an AI SDK 7-compatible RAG
release (>= 0.8.0.alpha.0).

Avoid installing with `--force`. Mixed AI SDK major versions can compile
against incompatible model, tool, and message types.

## 2. Rename top-level `system` to `instructions`

Agent continues to accept `system` temporarily, but it is deprecated. Use
`instructions` for top-level model guidance:

```typescript
const agent = new Agent(components.agent, {
  languageModel: openai("gpt-5"),
  instructions: "You are a helpful assistant.",
});

await agent.generateText(ctx, { threadId }, {
  prompt: "Hello",
  instructions: "Answer concisely.",
});
```

Stored system messages remain supported. Passing system messages in assembled
history requires `allowSystemInMessages: true`.

## 3. Update AI SDK types and callbacks

Agent's generation, streaming, tool, usage, warning, and provider types now
come from AI SDK 7. Re-run TypeScript after updating dependencies and fix
custom callbacks or wrappers that depend on AI SDK 6 types.

In particular:

- Use `mediaType` for AI SDK image and file parts.
- Update custom tools and provider options to their AI SDK 7 forms.
- Review code that consumes usage, warnings, response metadata, or step
  results; these now use AI SDK 7 shapes.

Agent still supports `maxSteps`; `stopWhen` remains the preferred AI SDK API.

## 4. Existing data and streamed files

No message-data migration is required. Agent reads messages saved by v0.6 and
writes new streams in the AI SDK 7 `UIMessageChunk` format. The stream reader
uses one reducer for the v0.6-compatible subset and the v0.7 superset.

This release does not offload every oversized inline file encoding. Top-level
`ArrayBuffer` image/file inputs and URL-backed files continue to work.
Reasoning files, nested tool-result files, and tagged/base64/data-URL payloads
will gain durable offloading separately.

## 5. Verify

```bash
pnpm exec tsc --noEmit
pnpm test
```

See the [AI SDK migration guides](https://ai-sdk.dev/docs/migration-guides)
for upstream breaking changes.

---

## More Information

- [AI SDK v7 Migration Guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0)
- [Convex Agent Documentation](https://docs.convex.dev/agents)

## Earlier migration: v0.3.x to v0.6.0 (AI SDK v6)

An earlier version of this guide to transition from AI SDK v5 to v6 can be found here:

https://github.com/get-convex/agent/blob/2ac74487d69462b6575e21526e09d52a9371c578/MIGRATION.md
