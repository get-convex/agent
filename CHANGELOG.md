# Changelog

## 0.1.10 alpha

- You can request that `syncStreams` return aborted streamed messages,
  if you want to show those in your UI.
- They will have `msg.streaming === false` if they were aborted.

## 0.1.9

- You can abort a stream asynchronously and have it stop writing deltas smoothly.
- The timeout for streaming deltas with no sign of life has been
  increased to 10 minutes.
- Delete stream deltas automatically 5 min after the stream finishes.
- Fix: deleting threads asynchronously will clean up deltas.
- Fix: update the reasoning in the top-level message when streaming

## 0.1.8

- Support images in localhost by loading them locally and passing them
  to the LLM as raw data. (author: @julionav)
- Add `updateMessage` to the raw components.agent.messages API for patching
  existing message contents, status, and error details. (author: @julionav)
- Add extensions to support NodeNext bundling
- Fix: paginating over all users now works for more than one page
- Fix: streams are now deleted when deleting threads / user data

## 0.1.7

- Image and file handling! It now auto-saves large input messages, and has an API
  to save and get metadata about files, as well as automatic reference counting for files
  being used in messages, so you can vacuum unused files.
  Check out [examples/files-images](./examples/files-images), which also includes an example
  generating an image and saving it in messages one-shot.
- Adds a `rawRequestResponseHandler` argument to the Agent that is a good spot to log or
  save all raw request/responses if you're trying to debug model behavior, headers, etc.
- Centralizes the example model usage so you can swap openai for openrouter / grok in one
  place.
- StorageOptions now takes a better argument name
  `saveMessages?: "all" | "none" | "promptAndOutput";`, deprecating
  `save{All,Any}InputMessages` and `saveOutputMessages`.
- Add `rawRequestResponseHandler` to the Agent definition, so you can log
  the raw request and response from the LLM.

### Deprecated

- The `files` field is deprecated in favor of `fileIds` in the message metadata.
  This wasn't really used before but it was possible folks discovered how to
  set it.

### Breaking

- The `steps` table is now gone. It will still be around in your backend, where
  you can inspect or clear it if you want, but it will not be written to, and
  the low-level APIs around saving steps alongside messages are gone.
  To get debug information, you can use the `rawRequestResponseHandler` and
  dump the request and response to your own debug table. Maybe conditional on
  some environment variable so you can turn it on/off for debugging.

## 0.1.6

- Fix pagination for the Agent messages when loading more
- Allow using useSmoothText in Next.js
- Fix: re-export `ToolCtx` in `@convex-dev/agent/react`

## 0.1.5

- APIs to get and update thread metadata on the agent / thread objects.
- Support generating embeddings asynchronously to save messages in mutations.
- Allow embedding generation to be done lazily by default.
- Build the project so it's compatible with composite and verbatim module syntax
- `useSmoothText` is even smoother
- Fix handling of file messages to include `filename` and `data` field instead of `file`.
- Fix bundling of api.d.ts to fix the `AgentComponent` type being `any`.
- More examples in the examples/ directory, that you can access from the root example
- Improve scripts for running the examples. See README.
- Starting to unify model definitions for examples so you only have to change it
  in one place to e.g. use grok.
- Better import hygiene for folks using `verbatimModuleSyntax`.

## 0.1.4

- Automatically pulls in the thread's userId when no userId is specified.
- Fixes bugs around duplicate content when streaming / using toUIMessages.
- `useSmoothText` is now even smoother with a stream rate that auto-adjusts.
- Defaults streaming chunks to sentence instead of word.

### Breaking

- The `userId` associated with the thread will automatically be associated with
  messages and tool calls, if no userId is passed at thread continuation or call-site.
  This is likely what you want, but in case you didn't, consider not setting a default
  userId for the thread and passing it in only when continuing the thread.
- The `searchMessage` and `textSearch` functions now take the more explicit
  parameter `searchAllMessagesForUserId` instead of `userId`.

## 0.1.3

- Allows you to pass `promptMessageId` to `agent.streamText`.
  This parameter allows you to create a message ahead of time and then
  generate the response separately, responding to that message.

## 0.1.2

- Added text delta streaming with `useThreadMessages` and `useStreamingThreadMessages` React hooks.
  See examples/chat-streaming for example usage.
- Also includes a `useSmoothText` hook and `optimisticallySendMessage`
  to get smooth streaming UI and immediate feedback when a user sends a msg.
- Adds a UIMessage type that is an AI SDK UIMessage with some extra fields
  for convenience, e.g. a stable key, order/stepOrder, streaming status.
- Allow listing threads without an associated userId in the playground.
- make stepOrder always increasing, for more predictable sorting of failed + non-failed messages.
- A reference to the agent is now passed to tool calls using the `createTool` utility.
- In more places, we aren't storing the AI SDK `id` unless explicitly passed in, and favoring the built-in Convex ID instead.
- The examples/ folder will become a better resource with more specific examples.
  For now, there's an index page when running the examples, that points to the text streaming and weather demos.
- There's now `listMessages` `saveMessage`, and `asSaveMessagesMutation` on the Agent.
  `listMessages` is compliant with the normal pagination API.

### Breaking

- `components.agent.messages.listMessagesByThreadId` is now `asc`ending by default!
  It'll have a type error to help you out.
  While you're at it, you can use the new `.listMessages` on the agent itself!
- `addStep` now returns the messages it created instead of a step.
  This is not likely to be called by clients directly. It's mostly used internally.
- `toUIMessages` has been moved to the `@convex-dev/agent/react` import entrypoint.

## 0.1.1

- The file api has been improved to allow for upserting files more correctly.
  You can use it to track images and files in messages, and have a cron that queries for images that can be safely deleted.
  When adding it to a message, call `addFile`, `useExistingFile`, or `copyFile` to get the `fileId` and add it to the message metadata.
  When the message is deleted, it will delete the file (if it has the last reference to it).
- Added an example for passing in images to LLMs.
- Embeddings of length 1408 are now supported.

## 0.1.0

- UI Playground, to host locally or embed into your app.
  - On the left panel it has a dropdown to select a users, then lists the user's treads
  - In the middle you can see the thread's messages and tool calls, as well as send new messages in the thread:
    - Configurable context & message saving options
    - Play with the system prompt for rapid prototyping.
  - On the right you can see the selected message's details, as well as fetch contextual messages to investigate what messages would get fetched for that message, with configurable ContextOptions.
  - Use the [hosted version](https://get-convex.github.io/agent/) or run it locally with `npx @convex-dev/agent-playground` - uses Vite internally for now.
  - API key management (to authenticate into the UI Playground)
- The `order` and `stepOrder` is now well defined: each call to something like `generateText` will be on the next "order" and each message generated from it will have increasing "subOrder" indexes.
- Adds a function to turn MessageDoc[] into UIMessage[].
- Eliminates an index to reduce storage cost per-message.
- The README is a better resource.

### Breaking

- `agent.fetchContextMessages` now returns `MessageDoc` instead of a `CoreMessage` objects.
- `isTool` configuration for context has been changed to `excludeToolMessages` - where `false`/`undefined` is the default and includes tool messages, and `true` will only return user/assistant messages.
- Reorganization of API (split `agent.messages.*` into `agent.threads.*`, `agent.messages.*`, `agent.files.*`, and `agent.users.*`.
- Parameters like `parentMessageId` have generally been renamed to `promptMessageId` or `beforeMessageId` or `upToAndIncludingMessageId` to better clarify their use for things like using an existing message as a prompt or searching context from before a message, or fetching messages up to and including a given message. The `generate*` / `stream*` functions can take a `promptMessageId` instead of a `prompt` / `messages` arg now.
- Calls to steps and objects now take a parentMessageId instead of messageId parameter, as this is the true meaning of parent message (the message being responded to).

### Deprecated

- The `steps` table is going away, to be replaced with a callback where you can dump your own comprehensive debug information if/when you want to. As such, the `stepId` field isn't returned on messages.
- The `parentMessageId` field is no longer exposed. Its purpose is now filled by the order & stepOrder fields: each message with the same order is a child of the message at stepOrder 0.

## 0.0.16

- Fixes a bug with providing out-of-order tool messages in the prompt context. (author: @apostolisCodpal)

## 0.0.15

- You can pass tools at the agent definition, thread definition, or per-message call, making it easier to define tools at runtime with runtime context.

- README improvements

### Breaking Changes

- `getEmbeddings` has been renamed to `generateEmbeddings`

### Deprecated

- Passing `ConfigOptions` and `StorageOptions` should now be passed as separate parameters via `configOptions` and `storageOptions`.
  e.g. for `generateText`
  `{ prompt }, { contextOptions: { recentMessages: 10 } }` instead of
  `{ prompt, recentMessages: 10 }`

## 0.0.14

- There is now a usageHandler you can specify on the Agent definition, thread, or per-message that can log or save token usage history.

- The model and provider are being stored on the messages table, along with usage, warnings, and other fields previously hidden away in the steps table.

### Bug fixes

- The agent name is now correctly propagating to the messages table for non-user messages.

### Deprecated

- parentThreadIds is deprecated, as it wasn't merging histories and the desire to do so should have a message as its parent to make the history behavior clear.
