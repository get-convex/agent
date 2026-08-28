import type {
  GenericActionCtx,
  GenericDataModel,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

export type AgentComponent = ComponentApi;

export type QueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
export type MutationCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
export type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction" | "storage" | "auth"
>;
