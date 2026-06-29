import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import { createWorkflow } from "./agent";

const workflow = createWorkflow(components);

export const workflowRun = workflow
  .define({
    args: { runId: v.string() },
  })
  .handler(async (step, args): Promise<void> => {
    await step.runAction(
      internal.support.runs.executeWorkflowRun,
      { runId: args.runId },
      { retry: true },
    );
  });
