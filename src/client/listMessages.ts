import type { PaginationOptions, PaginationResult } from "convex/server";
import type { AgentComponent, RunQueryCtx } from "./types.js";
import type { MessageStatus } from "../validators.js";
import type { MessageDoc } from "../component/schema.js";

/**
 * List messages from a thread.
 * @param ctx A ctx object from a query, mutation, or action.
 * @param component The agent component, usually `components.agent`.
 * @param args.threadId The thread to list messages from.
 * @param args.paginationOpts Pagination options (e.g. via usePaginatedQuery).
 * @param args.excludeToolMessages Whether to exclude tool messages.
 *   False by default.
 * @param args.statuses What statuses to include. All by default.
 * @returns The MessageDoc's in a format compatible with usePaginatedQuery.
 */
export async function listMessages(
  ctx: RunQueryCtx,
  component: AgentComponent,
  args: {
    threadId: string;
    paginationOpts: PaginationOptions;
    excludeToolMessages?: boolean;
    statuses?: MessageStatus[];
  }
): Promise<PaginationResult<MessageDoc>> {
  if (args.paginationOpts.numItems === 0) {
    return {
      page: [],
      isDone: true,
      continueCursor: args.paginationOpts.cursor ?? "",
    };
  }
  return ctx.runQuery(component.messages.listMessagesByThreadId, {
    order: "desc",
    ...args,
  });
}
