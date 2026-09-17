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

## assistant-ui example

Open **assistant-ui Chat** from the index (`/chat-assistant-ui`). The example
uses assistant-ui's runtime and primitives with the existing streaming backend.

- `ui/chat/ChatAssistantUI.tsx` connects Convex subscriptions and mutations to
  `useExternalStoreRuntime`, including optimistic sending, cancellation, and
  history.
- `ui/chat/assistantUiMessages.ts` converts Agent messages to assistant-ui
  messages.
- `ui/chat/AssistantChat.tsx` provides the composer, message layout, Markdown,
  copy controls, and compact expandable tool activity. Reasoning is hidden.
- `ui/chat/AssistantUIToolResult.tsx` renders server-side tool progress and
  results.
- `ui/chat/AssistantChat.module.css` contains all styling for this example.

This is a custom interface built with assistant-ui primitives, not a copy of its
registry Thread component. It requires no Tailwind configuration changes, global
CSS changes, or shadcn components. Markdown uses the existing `react-markdown`
dependency; the only additional direct dependency is `@assistant-ui/react`.

The example accepts text prompts. Attachments, editing, regeneration, branching,
and tool approvals are not implemented. It shares the other examples' model
configuration and demo thread authorization.
