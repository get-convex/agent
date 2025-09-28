import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import rag from "@convex-dev/rag/convex.config";
import cost from "./cost/convex.config.js";

const app = defineApp();
app.use(agent);
app.use(workflow);
app.use(rateLimiter);
app.use(cost);
app.use(rag);

export default app;
