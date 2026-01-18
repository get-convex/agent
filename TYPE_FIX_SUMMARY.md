# AI SDK v6 Type Error Fix Summary

## Problem
The build fails with TypeScript errors after upgrading to AI SDK v6. The main issues are:
1. `ToolCallPart` type now requires `input` field (not optional), but stored data may only have deprecated `args` field
2. Tool-result output types missing newer types like `execution-denied` and extended content types
3. Generated component types out of sync with updated validators

## Changes Made

### 1. Fixed `tool-call` Part Handling (src/mapping.ts)
- Updated `toModelMessageContent()` to ensure `input` is always present by falling back to `args` or `{}`
- Updated `serializeContent()` and `fromModelMessageContent()` to handle both `input` and legacy `args` fields
- This fixes the core issue where AI SDK v6's `ToolCallPart` expects non-nullable `input`

### 2. Fixed Tool Approval Response Handling (src/client/search.ts)
- Updated `filterOutOrphanedToolMessages()` to handle tool-approval-response parts that don't have `toolCallId`
- Tool-approval-response only has `approvalId`, not `toolCallId`

### 3. Updated Generated Component Types (src/component/_generated/component.ts)
Made manual updates to sync with validators (normally done via `convex codegen`):
- Added `input: any` field to all tool-call type definitions
- Made `args` optional (`args?: any`) in tool-call types  
- Added `execution-denied` output type to tool-result
- Added extended content types: `file-data`, `file-url`, `file-id`, `image-data`, `image-url`, `image-file-id`, `custom`
- Added `providerOptions` to text types in content values

## Remaining Issues (5 TypeScript errors)

The remaining errors are due to a structural mismatch in the generated component types:
- Generated types have BOTH `experimental_content` (deprecated) and `output` (new) fields on tool-result
- Our validators only define `output`, not `experimental_content`
- TypeScript is comparing our new output types against the old experimental_content types
- This cannot be fixed manually - requires proper component regeneration

### To Complete the Fix:
1. Run `convex codegen --component-dir ./src/component` with a valid Convex deployment
2. This will regenerate `src/component/_generated/component.ts` from the validators
3. The regenerated types will:
   - Remove the deprecated `experimental_content` field
   - Use only the `output` field with correct types
   - Properly match the validator definitions

### Error Locations:
- `src/client/index.ts:1052` - addMessages call
- `src/client/index.ts:1103` - addMessages call  
- `src/client/index.ts:1169` - updateMessage call
- `src/client/messages.ts:141` - addMessages call
- `src/client/start.ts:265` - addMessages call

All errors have the same root cause: content value types in tool-result output don't match experimental_content expectations.

## Testing Plan
Once component types are regenerated:
1. Run `npm run build` - should complete without errors
2. Run `npm test` - ensure no regressions
3. Test with actual AI SDK v6 workflow - verify tool-call handling works with both new `input` and legacy `args` fields

## Notes
- The mapping functions in `src/mapping.ts` correctly handle both old and new formats
- Data with only `args` will be converted to have `input` (with `args` as fallback)
- Data with `input` will work directly
- This provides backward compatibility while supporting AI SDK v6's requirements
