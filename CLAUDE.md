# Claude Code Guidelines for @convex-dev/agent

## AI SDK Version Compatibility

The package declares `"ai": "^5.0.29"` as a peer dependency but uses 5.0.82 in devDependencies.

**Key rules:**
- Always use type assertions when accessing properties that may not exist in all AI SDK 5.x versions
- The `LanguageModelUsage` type in 5.0.x does NOT have `inputTokenDetails` - use type assertion:
  ```typescript
  const inputTokenDetails = (usage as { inputTokenDetails?: { cacheReadTokens?: number } }).inputTokenDetails;
  ```
- `TypedToolResult` does not expose `isError` directly - use type assertion:
  ```typescript
  (result as { isError?: boolean }).isError === true
  ```

## UIMessage Types

When writing tests for UIMessages:

1. **Tool call types** use the format `type: "tool-${toolName}"`, not `type: "tool-call"`:
   ```typescript
   // WRONG
   { type: "tool-call", toolCallId: "..." }

   // CORRECT
   { type: "tool-toolA", toolCallId: "..." }
   ```

2. **Tool call states** must be one of: `"input-streaming" | "input-available" | "output-available" | "output-error"`:
   ```typescript
   // WRONG
   { state: "call" }
   { state: "result" }

   // CORRECT
   { state: "input-available" }
   { state: "output-available" }
   ```

3. **Tool outputs** must use the typed output format:
   ```typescript
   // WRONG
   { output: "result" }

   // CORRECT
   { output: { type: "text", value: "result" } }
   ```

4. **Tool UI parts** require the `input` field (even if undefined):
   ```typescript
   {
     type: "tool-myTool",
     toolCallId: "call_1",
     state: "input-available",
     input: {},  // Required
   }
   ```

## Error Handling in UIMessages

When storing tool errors:
- The `isError` flag may exist on stored tool results but isn't in the `ToolResultPart` TypeScript type
- Always cast when checking: `(contentPart as { isError?: boolean }).isError`
- `errorText` must be a `string`, not `string | undefined` - provide a default:
  ```typescript
  errorText: errorText ?? "Unknown error"
  ```

## Testing

- Always run `npm run test` AND `npm run typecheck` before committing
- The typecheck runs `tsc --noEmit && tsc -p example && tsc -p example/convex`
- Tests may pass but typecheck may fail if test data doesn't match types
