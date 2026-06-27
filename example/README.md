# Agent Core Example

This example app demonstrates the Convex-native Agent core through app-owned
composition. Agent owns durable runs, messages, tools, approvals, run events,
and HTTP serving. The app owns auth, retrieval, files, rate limits, and UI.

- durable Agent runs
- Agent-authored messages with typed parts
- run-owned stream events
- HTTP serving through `agent.http`
- app-owned context loaders
- app-owned file records and file message parts
- app-owned rate limit checks
- no external SDK message protocol or legacy stream-delta APIs

The backend lives in `example/convex/support/`. The frontend lives in
`example/src/main.tsx`, with reusable UI under `example/src/components`,
client-side projection state under `example/src/state`, and small helpers under
`example/src/lib`.

## Running The Example

From the repository root:

```bash
vp run build:codegen
npm run dev
```

The dev server is intentionally not started by Codex in this repository; run it
manually when you want to open the example.

If dependencies are missing, this package is currently npm-configured; run
`npm --force install` from the repository root before the commands above.

The UI expects `VITE_CONVEX_URL`. If your Convex site URL cannot be inferred by
replacing `.convex.cloud` with `.convex.site`, also set `VITE_CONVEX_SITE_URL`.

## Static Hosting

The example mounts `@convex-dev/static-hosting` as `components.staticHosting`,
serves the SPA from the Convex site URL, and keeps `/agent/run` reserved for the
Agent HTTP stream route.

From the repository root:

```bash
npm run build:demo
npm run deploy:demo:dev
```

Use `npm run deploy:demo:dev` to build and upload to the dev deployment in one
step. Use `npm run deploy:demo` to deploy the Convex backend, build the demo
with the production `VITE_CONVEX_URL`, and upload the assets to production
static hosting.

## What To Try

The demo is a single support-agent console. Send a normal message, attach
files, or ask for a refund/payment to trigger an approval-gated tool call
inline. The current run metadata, context blocks, and HTTP stream state stay in
the closed-by-default activity panel instead of becoming separate user-facing
pages.

The app intentionally has no auth layer. It uses one fixed demo user so the
example can focus on Agent runs, messages, tools, streams, and app-owned
composition. Real apps should derive `userId` from Convex Auth, Clerk/Auth0, or
their own server auth before calling Agent APIs.

## Model Provider

The example can use OpenRouter as an app-owned provider adapter. These
server-side Convex environment variables are declared in `convex.config.ts`, so
the backend reads them through Convex's typed generated `env` import:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=z-ai/glm-5.2
OPENROUTER_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
OPENROUTER_EMBEDDING_DIMENSIONS=4096
```

`OPENROUTER_MODEL` is optional and defaults to `z-ai/glm-5.2`.
`OPENROUTER_EMBEDDING_MODEL` is optional and defaults to
`qwen/qwen3-embedding-8b`. `OPENROUTER_EMBEDDING_DIMENSIONS` is optional and
defaults to `4096`. When the OpenRouter API key is configured, the app quietly
adds semantic retrieval context during execution. When it is absent, the same UI
works from recent thread messages and direct file attachments only.
`OPENROUTER_HTTP_REFERER` and `OPENROUTER_APP_TITLE` are optional attribution
values passed to OpenRouter.
The demo requests OpenRouter's throughput-oriented provider routing for faster
interactive replies.

Provider keys are never browser inputs and are not part of Agent core. This demo
uses `@openrouter/sdk` only in `example/` to translate OpenRouter responses into
Agent-owned run events. If `OPENROUTER_API_KEY` is missing, the demo falls back
to its deterministic local model so it remains runnable without a provider key.

The approval demo intentionally stays deterministic in this pass. Agent owns
tool approval, waiting, resume, messages, and streams; mapping provider-native
tool schemas to Agent-native tools is a separate adapter concern.

The app checks `@convex-dev/rate-limiter` on every send, uses
`@convex-dev/rag` only as an optional server-side retrieval implementation, and
stores uploaded files in app-owned `files` records before passing plain file
parts to Agent. For text-like uploads such as Markdown, JSON, CSV, or source
files, the browser extracts text before upload, stores that extracted text in
the app-owned `files` row, and passes it as direct run context. If embeddings
are configured, the same extracted text is also indexed for later retrieval.
Binary or unknown files stay metadata only; Agent never pretends it can read
contents the app did not extract.

The HTTP stream route exposes these correlation headers:

   - `X-Agent-Run-Id`
   - `X-Agent-Thread-Id`
   - `X-Agent-Message-Id`
   - `X-Stream-Id`

The deterministic fallback path requires no provider key.
