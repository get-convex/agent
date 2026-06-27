import { httpAction } from "../_generated/server";
import { coreAgent, caller } from "./shared";
import { requestMetadata } from "./request";

export const serve = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  const sessionId = url.searchParams.get("sessionId");
  if (!runId) {
    return new Response("Missing runId", { status: 400 });
  }
  if (!sessionId) {
    return new Response("Missing sessionId", { status: 400 });
  }
  const current = caller({ sessionId });
  const run = await coreAgent.runs.get(ctx, { runId });
  if (!run || run.userId !== current.userId) {
    return new Response("Not found", { status: 404 });
  }
  const metadata = await requestMetadata(ctx);
  const response = await coreAgent.http(ctx, request, { runId });
  response.headers.set("X-Request-Id", metadata.requestId ?? "");
  return response;
});
