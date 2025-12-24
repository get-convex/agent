# @convex-dev/agent

## Project Overview

`@convex-dev/agent` is a Convex component designed to provide powerful building blocks for creating agentic AI applications. It enables developers to separate long-running agentic workflows from the UI while maintaining reactivity and interactivity.

**Key Features:**
*   **Agents:** Abstraction for LLM usage with specific prompting, models, and tools.
*   **Threads & Messages:** Persistent conversation history shared by users and agents.
*   **Streaming:** efficient text and object streaming via deltas over websockets.
*   **Context:** Automatic inclusion of conversation context with hybrid vector/text search.
*   **RAG:** Support for Retrieval-Augmented Generation.
*   **Workflows:** Multi-step operations spanning agents and users.
*   **Files:** Support for file storage and reference counting in thread history.
*   **Debugging:** Built-in support for debugging via callbacks and a playground.
*   **Usage Tracking & Rate Limiting:** Tools for monitoring and controlling LLM usage.

## Tech Stack

*   **Language:** TypeScript
*   **Backend:** [Convex](https://convex.dev) (Component based)
*   **AI Framework:** [Vercel AI SDK](https://sdk.vercel.ai/docs) (`ai` package)
*   **Providers:** `@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.
*   **Testing:** Vitest
*   **Build Tool:** TypeScript Compiler (`tsc`), Vite (for example/playground)
*   **Linting:** ESLint, Prettier

## Key Directories & Files

*   **`src/`**: The core source code for the component.
    *   **`src/component/`**: Backend logic (Convex functions) defining the agent behavior.
    *   **`src/client/`**: Client-side SDK for interacting with the agent component.
    *   **`src/react/`**: React hooks and components for building frontend UIs.
*   **`example/`**: A full-stack example application using the component.
    *   `example/convex/`: Backend code for the example.
    *   `example/ui/`: Frontend code for the example.
*   **`playground/`**: A tool for testing and debugging agents.
*   **`convex.json`**: Configuration file for the Convex project.
*   **`src/component/convex.config.ts`**: Configuration for the Convex component.
*   **`package.json`**: Project dependencies and scripts.

## Development Workflow

### Setup
Initialize the project:
```bash
npm run setup
```

### Running in Development
Start both backend and frontend development servers:
```bash
npm run dev
```
*   `npm run dev:backend`: Starts the Convex backend dev server.
*   `npm run dev:frontend`: Starts the Vite frontend dev server (for the example).

### Building
Build the project:
```bash
npm run build
```

### Testing
Run tests using Vitest:
```bash
npm run test
```
*   `npm run test:watch`: Run tests in watch mode.
*   `npm run test:debug`: Run tests with debugging enabled.
*   `npm run test:coverage`: Run tests and generate a coverage report.

### Linting & Formatting
Lint the codebase:
```bash
npm run lint
```

## Conventions

*   **Convex Components:** The project follows the structure for Convex components, defined in `convex.config.ts`.
*   **Type Safety:** Heavy use of TypeScript and Convex validators (`v`) to ensure type safety across the stack.
*   **AI SDK Integration:** The agent implementation closely mirrors and integrates with the Vercel AI SDK patterns (`generateText`, `streamText`, `generateObject`, etc.).
