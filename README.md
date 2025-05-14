# Convex Agent Component

[![npm version](https://badge.fury.io/js/@convex-dev%2fagent.svg)](https://badge.fury.io/js/@convex-dev%2fagent)

<!-- START: Include on https://convex.dev/components -->

AI Agent framework built on Convex.

- Automatic storage of chat history, per-user or per-thread, that can span multiple agents.
- RAG for chat context, via hybrid text & vector search, with configuration options.
  Use the API to query the history yourself and do it your way.
- Opt-in search for messages from other threads (for the same specified user).
- Support for generating / streaming objects and storing them in messages (as JSON).
- Tool calls via the AI SDK, along with Convex-specific tool wrappers.
- Easy integration with the [Workflow component](https://convex.dev/components/workflow).
  Enables long-lived, durable workflows defined as code.
- Reactive & realtime updates from asynchronous functions / workflows.
- Support for streaming text and storing the final result.
- Optionally filter tool calls out of the thread history.

[Read the associated Stack post here](https://stack.convex.dev/ai-agents).

Example usage:

```ts
// Define an agent similarly to the AI SDK
const supportAgent = new Agent(components.agent, {
  chat: openai.chat("gpt-4o-mini"),
  textEmbedding: openai.embedding("text-embedding-3-small"),
  instructions: "You are a helpful assistant.",
  tools: { accountLookup, fileTicket, sendEmail },
});

// Use the agent from within a normal action:
export const createThread = action({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    // Start a new thread for the user.
    const { threadId, thread } = await supportAgent.createThread(ctx);
    // Creates a user message with the prompt, and an assistant reply message.
    const result = await thread.generateText({ prompt });
    return { threadId, text: result.text };
  },
});

// Pick up where you left off, with the same or a different agent:
export const continueThread = action({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    // Continue a thread, picking up where you left off.
    const { thread } = await anotherAgent.continueThread(ctx, { threadId });
    // This includes previous message history from the thread automatically.
    const result = await thread.generateText({ prompt });
    return result.text;
  },
});

// Or use it within a workflow, specific to a user:
export const { generateText: getSupport } = supportAgent.asActions({ maxSteps: 10 });

const workflow = new WorkflowManager(components.workflow);

export const supportAgentWorkflow = workflow.define({
  args: { prompt: v.string(), userId: v.string(), threadId: v.string() },
  handler: async (step, { prompt, userId, threadId }) => {
    const suggestion = await step.runAction(internal.example.getSupport, {
      threadId, userId, prompt,
    });
    const polished = await step.runAction(internal.example.adaptSuggestionForUser, {
      userId, suggestion,
    });
    await step.runMutation(internal.example.sendUserMessage, {
      userId, message: polished.message,
    });
  },
});
```

Also see the [Stack article](https://stack.convex.dev/ai-agents).

Found a bug? Feature request? [File it here](https://github.com/get-convex/agent/issues).

## Pre-requisite: Convex

You'll need an existing Convex project to use the component.
Convex is a hosted backend platform, including a database, serverless functions,
and a ton more you can learn about [here](https://docs.convex.dev/get-started).

Run `npm create convex` or follow any of the [quickstarts](https://docs.convex.dev/home) to set one up.

## Installation

Install the component package:

```ts
npm install @convex-dev/agent
```

Create a `convex.config.ts` file in your app's `convex/` folder and install the component by calling `use`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";

const app = defineApp();
app.use(agent);

export default app;
```

## Usage

### Configuring the agent

```ts
import { tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { Agent, createTool } from "@convex-dev/agent";
import { components } from "./_generated/api";

// Define an agent similarly to the AI SDK
const supportAgent = new Agent(components.agent, {
  // The chat completions model to use for the agent.
  chat: openai.chat("gpt-4o-mini"),
  // Embedding model to power vector search of message history (RAG).
  textEmbedding: openai.embedding("text-embedding-3-small"),
  // The default system prompt if not overriden.
  instructions: "You are a helpful assistant.",
  tools: {
    // Standard AI SDK tool
    myTool: tool({ description, parameters, execute: () => {}}),
    // Convex tool
    myConvexTool: createTool({
      description: "My Convex tool",
      args: z.object({...}),
      handler: async (ctx, args) => {
        return "Hello, world!";
      },
    }),
  },
  // Used for fetching context messages. Values shown are the defaults.
  contextOptions: {
    // Whether to include tool messages in the context.
    includeToolCalls: false,
    // How many recent messages to include. These are added after the search
    // messages, and do not count against the search limit.
    recentMessages: 100,
    // Options for searching messages via text and/or vector search.
    searchOptions: {
      limit: 10, // The maximum number of messages to fetch.
      textSearch: false, // Whether to use text search to find messages.
      vectorSearch: false, // Whether to use vector search to find messages.
      // Note, this is after the limit is applied.
      // E.g. this will quadruple the number of messages fetched.
      // (two before, and one after each message found in the search)
      messageRange: { before: 2, after: 1 },
    },
    // Whether to search across other threads for relevant messages.
    // By default, only the current thread is searched.
    searchOtherThreads: false,
  },
  // Used for storing messages.
  storageOptions: {
    // When false, allows you to pass in arbitrary context that will
    // be in addition to automatically fetched content.
    // Pass true to have all input messages saved to the thread history.
    saveAllInputMessages: false,
    // By default it saves the input message, or the last message if multiple are provided.
    saveAnyInputMessages: true,
    // Save the generated messages to the thread history.
    saveOutputMessages: true,
  },
  // Used for limiting the number of steps when tool calls are involved.
  maxSteps: 1,
  // Used for limiting the number of retries when a tool call fails.
  maxRetries: 3,
  // Used for tracking token usage.
  usageHandler: async (ctx, args) => {
    const {
      // Who used the tokens
      userId, threadId, agentName,
      // What LLM was used
      model, provider,
      // How many tokens were used (extra info is available in providerMetadata)
      usage, providerMetadata
    } = args;
    // ... log, save usage to your database, etc.
  },
});
```

### Starting a thread

You can start a thread from either an action or a mutation.
If it's in an action, you can also start sending messages.
The threadId allows you to resume later and maintain message history.
If you specify a userId, the thread will be associated with that user and messages will be saved to the user's history.
You can also search the user's history for relevant messages in this thread.

```ts
// Use the agent from within a normal action:
export const createThread = action({
  args: { prompt: v.string(), userId: v.string() },
  handler: async (ctx, { prompt, userId }): Promise<{ threadId: string; initialResponse: string }> => {
    // Start a new thread for the user.
+   const { threadId, thread } = await supportAgent.createThread(ctx, { userId });
    const result = await thread.generateText({ prompt });
    return { threadId, initialResponse: result.text };
  },
});
```

### Continuing a thread

If you specify a userId too, you can search the user's history for relevant messages
to include in the prompt context.

```ts
// Pick up where you left off:
export const continueThread = action({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }): Promise<string> => {
    // This includes previous message history from the thread automatically.
+   const { thread } = await supportAgent.continueThread(ctx, { threadId });
    const result = await thread.generateText({ prompt });
    return result.text;
  },
});
```

### Sending a message with configurable message history context

You can customize what history is included per-message via `contextOptions`.
See the [configuring the agent](#configuring-the-agent) section for details.

```ts
const result = await thread.generateText({ prompt }, { contextOptions });
```

### Configuring the storage of messages

See the [configuring the agent](#configuring-the-agent) section for details.
Generally the defaults are fine, but if you want to pass in multiple messages
and have them all saved (vs. just the last one), or avoid saving any input
or output messages, you can pass in a `storageOptions` object.

The usecase for passing multiple messages is if you want to include some extra
messages for context to the LLM, but only the last message is the user's actual
request. e.g. `messages = [...messagesFromRag, messageFromUser]`.

```ts
const result = await thread.generateText({ messages }, { storageOptions });
```

### Creating a tool with Convex context

There are two ways to create a tool that has access to the Convex context.

1. Use the `createTool` function, which is a wrapper around the AI SDK's `tool` function.

```ts
export const ideaSearch = createTool({
  description: "Search for ideas in the database",
  args: z.object({ query: z.string() }),
  handler: async (ctx, args): Promise<Array<Idea>> => {
    // ctx has userId, threadId, messageId, runQuery, runMutation, and runAction
    const ideas = await ctx.runQuery(api.ideas.searchIdeas, { query: args.query });
    console.log("found ideas", ideas);
    return ideas;
  },
});
```

2. Define tools at runtime in a context with the variables you want to use.

```ts
async function createTool(ctx: ActionCtx, teamId: Id<"teams">) {
  const myTool = tool({
    description: "My tool",
    parameters: z.object({...}),
    execute: async (args, options) => {
      return await ctx.runQuery(internal.foo.bar, args);
    },
  });
}
```

You can provide tools at different times:

- Agent contructor: (`new Agent(components.agent, { tools: {...} })`)
- Creating a thread: `createThread(ctx, { tools: {...} })`
- Continuing a thread: `continueThread(ctx, { tools: {...} })`
- On thread functions: `thread.generateText({ tools: {...} })`
- Outside of a thread: `supportAgent.generateText(ctx, {}, { tools: {...} })`

Specifying tools at each layer will overwrite the defaults.
The tools will be `args.tools ?? thread.tools ?? agent.options.tools`.
This allows you to create tools in a context that is convenient.

### Fetching thread history

Fetch the full messages directly. These will include things like usage, etc.

```ts
const messages = await ctx.runQuery(
  components.agent.messages.getThreadMessages, {
    threadId,
    order: "desc",
    paginationOpts: { cursor: null, numItems: 10 }
});
```

### Search for messages

This is what the agent does automatically, but it can be useful to do manually, e.g. to find custom context to include.

Fetch CoreMessages (e.g. `{ role, content }`) for a user and/or thread.
Accepts ContextOptions, e.g. includeToolCalls, searchOptions, etc.
If you provide a `beforeMessageId`, it will only fetch messages from before that message.

```ts
const coreMessages = await supportAgent.fetchContextMessages(ctx, {
  threadId, messages: [{ role, content }], contextOptions
});
```

## Using the Workflow component for long-lived durable workflows

The [Workflow component](https://convex.dev/components/workflow) is a great way to build long-lived, durable workflows.
It handles retries and guarantees of eventually completing, surviving server restarts, and more.
Read more about durable workflows in [this Stack post](https://stack.convex.dev/durable-workflows-and-strong-guarantees).


### Exposing the agent as Convex actions

You can expose the agent as a Convex internal action.
This is generally used from a workflow, where each step is a new thread message.

```ts
export const getSupport = supportAgent.asTextAction({
  maxSteps: 10,
});
```

You can also expose a standalone action that generates an object.

```ts
export const getStructuredSupport = supportAgent.asObjectAction({
  schema: z.object({
    analysis: z.string().describe("A detailed analysis of the user's request."),
    suggestion: z.string().describe("A suggested action to take.")
  }),
});
```

Create a thread from within a workflow, similar to agent.createThread.

```ts
export const createThread = supportAgent.createThreadMutation();
```

### Using the agent actions within a workflow

You can use the [Workflow component](https://convex.dev/components/workflow)
to run agent flows. It handles retries and guarantees of eventually completing,
surviving server restarts, and more. Read more about durable workflows
[in this Stack post](https://stack.convex.dev/durable-workflows-and-strong-guarantees).

```ts
const workflow = new WorkflowManager(components.workflow);

export const supportAgentWorkflow = workflow.define({
  args: { prompt: v.string(), userId: v.string() },
  handler: async (step, { prompt, userId }) => {
    const { threadId } = await step.runMutation(internal.example.createThread, {
      userId, title: "Support Request",
    });
    const suggestion = await step.runAction(internal.example.getSupport, {
      threadId, userId, prompt,
    });
    const polished = await step.runAction(internal.example.adaptSuggestionForUser, {
      userId, suggestion,
    });
    await step.runMutation(internal.example.sendUserMessage, {
      userId, message: polished.message,
    });
  },
});
```

See another example in [example.ts](./example/convex/example.ts#L120).

## Extra control: how to do more things yourself

### Generating text for a user without an associated thread

```ts
const result = await supportAgent.generateText(ctx, { userId }, { prompt });
```

### Saving messages manually

Save messages to the database.

```ts
const { lastMessageId, messageIds} = await agent.saveMessages(ctx, {
  threadId, userId,
  messages: [{ role, content }],
  metadata: [{ reasoning, usage, ... }] // See MessageWithMetadata type
});
```

### Manage embeddings

Generate embeddings for a set of messages.

```ts
const embeddings = await supportAgent.generateEmbeddings([
  { role: "user", content: "What is love?" },
]);
```

Get and update embeddings, e.g. for a migration to a new model.

```ts
const messages = await ctx.runQuery(
  components.agent.vector.index.paginate,
  { vectorDimension: 1536, cursor: null, limit: 10 }
);
```

Note: If the dimension changes, you need to delete the old and insert the new.

```ts
const messages = await ctx.runQuery(components.agent.vector.index.updateBatch, {
  vectors: [
    { model: "gpt-4o-mini", vector: embedding, id: msg.embeddingId },
  ],
});
```

Delete embeddings

```ts
const messages = await ctx.runQuery(components.agent.vector.index.deleteBatch, {
  ids: [embeddingId1, embeddingId2],
});
```

Insert embeddings

```ts
const messages = await ctx.runQuery(
  components.agent.vector.index.insertBatch, {
    vectorDimension: 1536,
    vectors: [
      { model: "gpt-4o-mini", table: "messages", userId: "123", threadId: "123", vector: embedding, },
    ],
  }
);
```

See example usage in [example.ts](./example/convex/example.ts).
Read more in [this Stack post](https://stack.convex.dev/ai-agents).

```sh
npm i @convex-dev/agent
```

### Tracking token usage

You can provide a `usageHandler` to the agent to track token usage.
See an example in
[this demo](https://github.com/ianmacartney/ai-agent-chat/blob/main/convex/chat.ts)
that captures usage to a table, then scans it to generate per-user invoices.

```ts
const supportAgent = new Agent(components.agent, {
  ...
  usageHandler: async (ctx, args) => {
    const { userId, threadId, agentName } = args;
    const { model, provider, usage, providerMetadata } = args;
    // ... save usage to your database, etc.
  },
});
// or when creating/continuing a thread:
const { thread } = await supportAgent.createThread(ctx, {
  ...
  usageHandler: async (ctx, args) => {
    // ...
  },
});
// or when generating text:
const result = await thread.generateText({
  ...
  usageHandler: async (ctx, args) => {
    // ...
  },
});
```

Tip: Define the `usageHandler` within a function where you have more variables
available to attribute the usage to a different user, team, project, etc.

## Troubleshooting

### Circular dependencies

Having the return value of workflows depend on other Convex functions can lead to circular dependencies due to the
`internal.foo.bar` way of specifying functions. The way to fix this is to explicitly type the return value of the
workflow. When in doubt, add return types to more `handler` functions, like this:

```diff
 export const supportAgentWorkflow = workflow.define({
   args: { prompt: v.string(), userId: v.string(), threadId: v.string() },
+  handler: async (step, { prompt, userId, threadId }): Promise<string> => {
     // ...
   },
 });

 // And regular functions too:
 export const myFunction = action({
   args: { prompt: v.string() },
+  handler: async (ctx, { prompt }): Promise<string> => {
     // ...
   },
 });
```


<!-- END: Include on https://convex.dev/components -->
