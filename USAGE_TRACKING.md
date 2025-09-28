## Usage Tracking with `call.saveStepUsage`

The new `call.saveStepUsage` function provides a clean way to save step usage data, similar to how `call.save` works for messages.

### How it works

When you use the `start` function from an agent, the returned `call` object now includes a `saveStepUsage` function:

```typescript
const { args, call, ... } = await agent.start(ctx, generateTextArgs, options);

// In your onStepFinish callback:
onStepFinish: async (step) => {
  steps.push(step);
  await call.save({ step }, createPendingMessage);
  
  // Save usage data automatically
  await call.saveStepUsage(step);
  
  return args.onStepFinish?.(step);
}
```

### What it does

The `call.saveStepUsage` function:
1. Checks if the step has usage data and required IDs (threadId, userId)
2. Gets the most recently saved message from `call.getSavedMessages()`
3. Serializes the AI SDK usage data using the existing `serializeUsage` function
4. Calls a `pricePerRequest.create` mutation (if available) with:
   - `messageId`: ID of the associated message
   - `userId`: User who triggered the generation
   - `threadId`: Thread where the generation occurred  
   - `usage`: Serialized usage data (promptTokens, completionTokens, etc.)
   - `calculatedAt`: Current timestamp
   - `model`: Model name used for generation
   - `provider`: Provider name used for generation

### Usage data structure

The usage data is automatically serialized from AI SDK format to Convex format:

```typescript
// AI SDK format
step.usage: {
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  reasoningTokens?: 20,
  cachedInputTokens?: 10
}

// Serialized to Convex format
usage: {
  promptTokens: 100,      // mapped from inputTokens
  completionTokens: 50,   // mapped from outputTokens  
  totalTokens: 150,
  reasoningTokens: 20,    // optional
  cachedInputTokens: 10   // optional
}
```

### Implementation in streamText and generateText

The `streamText` and `generateText` methods now automatically call `call.saveStepUsage(step)` in their `onStepFinish` callbacks, so usage data is tracked by default when you use these methods.

### Setting up the pricePerRequest component

To use this feature, you need to add a `pricePerRequest` component with a `create` mutation to your Convex schema. See the example implementation in the codebase.

### Benefits

- **Consistent with existing patterns**: Uses the same approach as `call.save`
- **Automatic serialization**: Handles AI SDK to Convex format conversion
- **Safe**: Only calls the mutation if the component exists
- **Flexible**: Easy to extend with cost calculation logic
- **Integrated**: Works automatically with existing `streamText` and `generateText` methods
