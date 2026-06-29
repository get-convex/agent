/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as http from "../http.js";
import type * as staticHosting from "../staticHosting.js";
import type * as support_activity from "../support/activity.js";
import type * as support_agent from "../support/agent.js";
import type * as support_cases from "../support/cases.js";
import type * as support_context from "../support/context.js";
import type * as support_files from "../support/files.js";
import type * as support_http from "../support/http.js";
import type * as support_knowledge from "../support/knowledge.js";
import type * as support_messages from "../support/messages.js";
import type * as support_request from "../support/request.js";
import type * as support_runs from "../support/runs.js";
import type * as support_shared from "../support/shared.js";
import type * as support_tools from "../support/tools.js";
import type * as support_workflow from "../support/workflow.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  staticHosting: typeof staticHosting;
  "support/activity": typeof support_activity;
  "support/agent": typeof support_agent;
  "support/cases": typeof support_cases;
  "support/context": typeof support_context;
  "support/files": typeof support_files;
  "support/http": typeof support_http;
  "support/knowledge": typeof support_knowledge;
  "support/messages": typeof support_messages;
  "support/request": typeof support_request;
  "support/runs": typeof support_runs;
  "support/shared": typeof support_shared;
  "support/tools": typeof support_tools;
  "support/workflow": typeof support_workflow;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rag: import("@convex-dev/rag/_generated/component.js").ComponentApi<"rag">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
