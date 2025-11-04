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
