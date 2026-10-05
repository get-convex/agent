import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  FunctionVisibility,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

export type AgentComponent = ComponentApi;

/**
 * The part of a @convex-dev/workflow step ctx the agent uses, declared here so
 * the workflow package is not a dependency.
 */
export type WorkflowStepCtx = {
  workflowId: string;
  runQuery<Query extends FunctionReference<"query", FunctionVisibility>>(
    query: Query,
    args: FunctionArgs<Query>,
    opts?: { inline?: boolean },
  ): Promise<FunctionReturnType<Query>>;
  runMutation<
    Mutation extends FunctionReference<"mutation", FunctionVisibility>,
  >(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
    opts?: { inline?: boolean },
  ): Promise<FunctionReturnType<Mutation>>;
};

export type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
export type MutationCtx =
  | Pick<GenericMutationCtx<GenericDataModel>, "runQuery" | "runMutation">
  | WorkflowStepCtx;
export type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction" | "storage" | "auth"
>;
