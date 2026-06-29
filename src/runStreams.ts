import { defineStream } from "@convex-dev/stream";
import { v } from "convex/values";
import { vAgentRunEvent } from "./validators.js";

/** @internal */
export const vAgentRunStreamMetadata = v.object({
  runId: v.id("runs"),
  threadId: v.id("threads"),
  userId: v.optional(v.string()),
  agentName: v.string(),
});

/**
 * Define the Stream handle Agent uses for durable run events.
 *
 * @internal
 */
export function defineAgentRunEventStream(
  component: Parameters<typeof defineStream>[0],
) {
  return defineStream(component, {
    name: "agent-run-events",
    event: vAgentRunEvent,
    metadata: vAgentRunStreamMetadata,
  });
}
