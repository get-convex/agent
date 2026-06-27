import { vAgentMessageDoc } from "@convex-dev/agent";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { query } from "../_generated/server";
import { vSessionId } from "./agent";
import {
  caller,
  coreAgent,
  emptyPage,
  findActiveCase,
} from "./shared";

export const list = query({
  args: {
    sessionId: vSessionId,
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(vAgentMessageDoc),
  handler: async (ctx, args) => {
    const current = caller(args);
    const supportCase = await findActiveCase(ctx, current.userId);
    if (!supportCase) {
      return emptyPage;
    }
    return await coreAgent.messages.list(ctx, {
      threadId: supportCase.threadId,
      order: "desc",
      paginationOpts: args.paginationOpts,
    });
  },
});
