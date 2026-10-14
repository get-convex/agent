# Agent Example

This is an example app that uses the `@convex-dev/agent` package.

See the [Agent docs](https://docs.convex.dev/agents) for documentation.

The backend usage is in `convex/`, with folders to organize usecases. The
frontend usage is in `ui/`.

The example exercises many usecases, with the underlying code organized into
folders by category.

The main difference from your app will be:

- What models you use (currently uses `modelsForDemo.ts`)
- Usage handling - currently configures agents to use `usageHandler.ts`
- How you handle auth - currently has an example `authorizeThreadAccess`
  function.

## Running the example

```bash
git clone https://github.com/get-convex/agent.git
cd agent
npm run setup
npm run dev
```

## assistant-ui chat

Open **assistant-ui Chat** from the example index (`/chat-assistant-ui`). It
uses [assistant-ui](https://www.assistant-ui.com/) primitives for the composer,
message list, Markdown, copy action, and scroll controls. Expand a tool card to
inspect its arguments and result, use **Load earlier messages** to paginate
history, or start a new conversation from the header. The URL hash identifies
the thread, so reloading the page restores its messages.

The frontend lives in `ui/chat/assistant-ui/`, with the page in
`ui/chat/ChatAssistantUI.tsx`:

- `useConvexRuntime.ts` connects `useUIMessages(..., { stream: true })` to
  `useExternalStoreRuntime`. Convex owns the messages and streams; there is no
  second message store or HTTP streaming endpoint.
- `convertMessage.ts` maps the story agent's text, reasoning, and tool parts to
  assistant-ui messages. It uses Convex's stable `key` so the streamed message
  and its persisted replacement retain the same UI identity.
- `Thread.tsx` composes the chat UI from assistant-ui primitives.

Sending calls the existing `chat.streaming.streamOneShot` action, which resolves
once the response is persisted. The hook tracks that action while waiting for
the first streamed message; the pagination hook's `status` describes loading
history, not generation. User messages appear when Convex saves them. For an
optimistic send flow, see the existing **Streaming Chat** example.

**Stop response** becomes available once Convex exposes a stream, and calls the
existing `chat.streamAbort.abortStreamByOrder` mutation. A stopped or failed
response retains its partial content. This example accepts text input; file
uploads and tool approval have their own examples in the index.

To use OpenAI instead of the demo's fallback, set a server-side key from the
repository root (the CLI prompts for the value):

```bash
npx convex env set OPENAI_API_KEY
```

Model selection is in `convex/modelsForDemo.ts`. Keep provider keys in the
Convex deployment environment, never in `VITE_*` variables. The existing demo's
`authorizeThreadAccess` helper is shared with this page; implement your app's
authentication and thread permissions before deploying it for users.
