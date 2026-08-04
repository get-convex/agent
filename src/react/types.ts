import type { BetterOmit, Expand } from "convex-helpers";
import type { FunctionArgs, FunctionReference } from "convex/server";
import type { SyncStreamsReturnValue } from "../client/types.js";
import type { StreamArgs } from "../validators.js";

export type StreamQuery<Args = Record<string, unknown>> = FunctionReference<
  "query",
  "public",
  {
    threadId: string;
    streamArgs?: StreamArgs; // required for stream query
  } & Args,
  // `streams` is optional so that queries with a `returns` validator
  // (e.g. `vStreamUIMessagesReturnValue`, where `streams` is `v.optional`)
  // also count as stream queries. Queries that don't return `streams` at
  // all still don't match, since there are no properties in common.
  { streams?: SyncStreamsReturnValue }
>;

export type StreamQueryArgs<Query extends StreamQuery<unknown>> =
  Query extends StreamQuery<unknown>
    ? Expand<BetterOmit<FunctionArgs<Query>, "streamArgs">>
    : never;
