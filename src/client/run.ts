import type {
  FunctionArgs,
  FunctionReference,
  FunctionVisibility,
} from "convex/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./types.js";

/**
 * Like ctx.runMutation, but supports inline mutations in workflows.
 */
export function runMutation<
  Fn extends FunctionReference<"mutation", FunctionVisibility>,
>(ctx: MutationCtx | ActionCtx, fn: Fn, args: FunctionArgs<Fn>) {
  if ("workflowId" in ctx) {
    return ctx.runMutation(fn, args, { inline: true });
  } else {
    return ctx.runMutation(fn, args);
  }
}

/**
 * Like ctx.runQuery, but supports inline queries in workflows.
 */
export function runQuery<
  Fn extends FunctionReference<"query", FunctionVisibility>,
>(ctx: QueryCtx | MutationCtx | ActionCtx, fn: Fn, args: FunctionArgs<Fn>) {
  if ("workflowId" in ctx) {
    return ctx.runQuery(fn, args, { inline: true });
  } else {
    return ctx.runQuery(fn, args);
  }
}
