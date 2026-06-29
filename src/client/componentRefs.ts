import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { Id } from "../component/_generated/dataModel.js";
import type { ComponentApi } from "../component/_generated/component.js";

export type AgentMutationCtx = Pick<
  GenericMutationCtx<GenericDataModel> | GenericActionCtx<GenericDataModel>,
  "runMutation"
>;
export type AgentQueryCtx = Pick<
  GenericQueryCtx<GenericDataModel> | GenericActionCtx<GenericDataModel>,
  "runQuery"
>;
export type AgentExecutionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runAction" | "runMutation" | "runQuery"
>;
export type AgentHttpCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;

export type AgentComponent = ComponentApi;

export function toComponentThreadId(value: string): Id<"threads"> {
  return value as Id<"threads">;
}

export function toComponentRunId(value: string): Id<"runs"> {
  return value as Id<"runs">;
}

export function toComponentMessageId(value: string): Id<"messages"> {
  return value as Id<"messages">;
}

export function maybeComponentMessageId(
  value: string | undefined,
): Id<"messages"> | undefined {
  return value === undefined ? undefined : toComponentMessageId(value);
}
