# Convex Agent Component

[![npm version](https://badge.fury.io/js/@convex-dev%2fagent.svg)](https://badge.fury.io/js/@convex-dev%2fagent)

<!-- START: Include on https://convex.dev/components -->

- [ ] What is some compelling syntax as a hook?
- [ ] Why should you use this component?
- [ ] Links to Stack / other resources?

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

```ts
import { components } from "./_generated/api";
import { Agent } from "@convex-dev/agent";

const agent = new Agent(components.agent, {
  ...options,
});
```

See more example usage in [example.ts](./example/convex/example.ts).

<!-- END: Include on https://convex.dev/components -->
