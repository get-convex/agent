# Developing guide

## Running locally

```sh
npm run setup
npm run dev
```

## Testing

```sh
npm run clean
npm run build
npm run test
npm run typecheck
npm run lint
```

## Deploying

### Building a one-off package

```sh
npm run clean
npm run build
npm pack
```

### Deploying a new version

Patch release:

```sh
npm run release
```

#### Alpha release

The same as above, but it requires extra flags so the release is only installed
with `@alpha`:

```sh
npm run alpha
```

# Idea/ feature backlog:

- Convenience function to create a thread by copying an existing thread (fork)
- Add a "failed" message when an error is thrown in generate/stream call.
- Add a "failed" message when a stream is aborted.
- Support new AI SDK version (and LanguageModelProviderV2)
- Add a `contextHandler` option to the Agent component, that can be used to see
  and modify the context passed to the LLM before it's called.
  - take in { searchMessages, recentMessages, systemMessage, promptMessage }
  - returns single message[]? - can add / prune / modify or { searchMessages,
    recentMessages, systemMessage, promptMessage } or something else?
- When aborting a stream, save the in-progress message as failed with the
  contents so far, and replace the abort.
- Allow aborting normal generateText
- Add a placeholder aborted message, check for that when adding step (conflict
  in step order)
- Improve the demo to show more of the features & have nicer UI
  - Add an example of aborting a stream.
  - Add an example of using tracing / telemetry.
- Refactor agent code to more helper functions, and break up `client/index.ts`
  into more files.
- Add an example of using MCP with the Agent.
- Automatically turn big text content into a file when saving a message and keep
  as a fileId. Re-hydrate it when reading out for generation.
- When a generateText finishes with a tool call, return a `continue` fn that can
  be used to save the tool call response(s) and continue the generation at the
  same order.
- Add a configurable storage provider - consistent API Maybe they have to pass
  in an equivalent of `components.agent.{messages,threads}`

## Playground feature wishlist (contributions welcome!)

- List all threads instead of user dropdown.
  - If a user is logged in, use their userId instead of the apiKey for auth &
    return only their threads.
- Show threads that aren't associated with a user as "no user" in the dropdown.
- Add a "fork thread" button in the right message detail sidebar.
- Add a "retry" button to regenerate a response while tuning the prompt/context.
- Show the contextual messages with their rank in vector & text search, to get a
  sense of what is being found via text vs. vector vs. recency search.
- Show the agent's default context & storage options.
- Show tools and allow calling them directly.
- Generate objects from the UI, not just text.
- Archive messages
- Configure which tools are available when doing one-off messaging.
- Trace older messages for what exact context they used.
