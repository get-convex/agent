// See the docs at https://docs.convex.dev/agents/playground
import { definePlaygroundAPI } from "@convex-dev/agent";
import { components } from "./_generated/api";
import { weatherAgent } from "./agents/weather";
import { fashionAgent } from "./agents/fashion";
import { storyAgent } from "./agents/story";
import { agent as basicAgent } from "./agents/simple";
import { fileAgent } from "./files/addFile";
import { rateLimitedAgent } from "./rate_limiting/rateLimiting";

/**
 * Here we expose the API so the frontend can access it.
 * Authorization is handled by passing up an apiKey that can be generated
 * on the dashboard or via CLI via:
 * ```
 * npx convex run --component agent apiKeys:issue
 * ```
 */
export const {
  isApiKeyValid,
  listAgents,
  listUsers,
  listThreads,
  listMessages,
  createThread,
  generateText,
  fetchPromptContext,
} = definePlaygroundAPI(components.agent, {
  agents: async (/*ctx, { userId, threadId }*/) => [
    weatherAgent,
    fashionAgent,
    basicAgent,
    storyAgent,
    fileAgent,
    rateLimitedAgent,
  ],
});
