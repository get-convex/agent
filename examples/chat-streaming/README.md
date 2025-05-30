# Streaming Chat Example

This example shows how to use the `@convex-dev/agent` component to build a streaming chat application.

The approach sends text deltas via the websocket, and then merges them in with
the full message in a React hook.

## Server setup

See [`listThreadMessages` in streaming.ts](./convex/streaming.ts) for the server-side code.

You have a function that both allows paginating over messages, as well as taking
in a `streamArgs` object and returning the `streams` result from `syncStreams`.

```ts
 export const listThreadMessages = query({
   args: {
     threadId: v.string(),
     paginationOpts: paginationOptsValidator,
     streamArgs: vStreamArgs,
     //... other arguments you want
   },
   handler: async (ctx, { threadId, paginationOpts, streamArgs }) => {
     // await authorizeThreadAccess(ctx, threadId);
     const paginated = await agent.listMessages(ctx, { threadId, paginationOpts });
     const streams = await agent.syncStreams(ctx, { threadId, streamArgs });
     // Here you could filter out / modify the documents & stream deltas.
     return { ...paginated, streams };
   },
 });
```

### Client setup

See [ChatStreaming.tsx](./src/ChatStreaming.tsx) for the client-side code.

The crux is to use the `useThreadMessages` hook, and pass in `stream: true`:

```ts
const messages = useThreadMessages(
  api.streaming.listThreadMessages,
  { threadId },
  { initialNumItems: 10, stream: true },
);
```

### Text smoothing

The `useSmoothText` hook is a simple hook that smooths the text as it is streamed.

```ts
const [visibleText] = useSmoothText(message.content);
```

See [ChatStreaming.tsx](./src/ChatStreaming.tsx) for an example.

### Optimistic updates for sending messages

The `optimisticallySendMessage` function is a simple function that
optimistically shows a message in the message list until the mutation has
completed on the server.

Pass in the query that you're using to list messages, and it will insert the
ephemeral message at the top of the list.

```ts
const sendMessage = useMutation(api.streaming.streamStoryAsynchronously)
  .withOptimisticUpdate(optimisticallySendMessage(api.streaming.listThreadMessages));
```

## Running the example

```sh
npm run i
npm run setup
cd examples/chat-streaming
npm i
npm run dev
```
