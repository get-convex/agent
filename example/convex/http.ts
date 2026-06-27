import { httpRouter } from "convex/server";
import { serve as serveCoreRun } from "./support/http";
import { corsRouter } from "convex-helpers/server/cors";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";

const http = httpRouter();

const cors = corsRouter(http, {
  allowCredentials: true,
  allowedHeaders: ["Content-Type", "Last-Event-ID"],
  exposedHeaders: [
    "Content-Type",
    "Content-Length",
    "X-Agent-Run-Id",
    "X-Agent-Thread-Id",
    "X-Agent-Message-Id",
    "X-Stream-Id",
    "X-Request-Id",
  ],
});

cors.route({
  path: "/agent/run",
  method: "GET",
  handler: serveCoreRun,
});

registerStaticRoutes(http, components.staticHosting);

export default http;
