import { defineApp } from "convex/server";
import { v } from "convex/values";
import agent from "@convex-dev/agent/convex.config";
import rag from "@convex-dev/rag/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import workflow from "@convex-dev/workflow/convex.config";

const app = defineApp({
  env: {
    OPENROUTER_API_KEY: v.optional(v.string()),
    OPENROUTER_MODEL: v.optional(v.string()),
    OPENROUTER_EMBEDDING_MODEL: v.optional(v.string()),
    OPENROUTER_EMBEDDING_DIMENSIONS: v.optional(v.string()),
    OPENROUTER_HTTP_REFERER: v.optional(v.string()),
    OPENROUTER_APP_TITLE: v.optional(v.string()),
  },
});
app.use(agent);
app.use(rag);
app.use(rateLimiter);
app.use(staticHosting, { name: "staticHosting" });
app.use(workflow);

export default app;
