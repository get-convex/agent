import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
const app = defineApp();
app.use(agent);
export default app;
