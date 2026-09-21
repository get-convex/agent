import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { WorkflowCtx } from "@convex-dev/workflow";
import type { ComponentApi } from "../component/_generated/component.js";

export type AgentComponent = ComponentApi;

export type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
export type MutationCtx =
  | Pick<GenericMutationCtx<GenericDataModel>, "runQuery" | "runMutation">
  | WorkflowCtx;
export type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction" | "storage" | "auth"
>;
