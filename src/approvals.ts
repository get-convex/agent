import type { Message, MessageDoc } from "./validators.js";

export type ToolCallApprovalDecision = {
  approvalId: string;
  approved: boolean;
  reason?: string;
};

// The window a batch is resolved against. Approvals are near the end of a
// thread, so one bounded page finds them.
export const APPROVAL_LOOKUP_MESSAGES = 100;

export function planToolCallApprovals(
  messages: MessageDoc[],
  decisions: ToolCallApprovalDecision[],
  threadId: string,
): { requestMessageId: string; message: Extract<Message, { role: "tool" }> } {
  if (decisions.length === 0) {
    throw new Error("An approval batch must contain at least one decision");
  }
  const pending = new Set(decisions.map(({ approvalId }) => approvalId));
  if (pending.size !== decisions.length) {
    throw new Error("Duplicate approval ids in batch");
  }
  let requestMessageId: string | undefined;
  const providerExecuted = new Set<string>();

  for (const doc of messages) {
    if (!Array.isArray(doc.message?.content)) continue;
    const providerCalls = new Set(
      doc.message.content.flatMap((part) =>
        part.type === "tool-call" && part.providerExecuted
          ? [part.toolCallId]
          : [],
      ),
    );
    for (const part of doc.message.content) {
      if (!("approvalId" in part) || !pending.has(part.approvalId)) continue;
      if (part.type === "tool-approval-response") {
        throw new Error(`Approval ${part.approvalId} was already handled`);
      }
      if (
        part.type === "tool-approval-request" &&
        doc.message.role === "assistant"
      ) {
        if (requestMessageId && requestMessageId !== doc._id) {
          throw new Error(
            "Approval decisions in one batch must belong to the same request message",
          );
        }
        requestMessageId = doc._id;
        if (providerCalls.has(part.toolCallId)) {
          providerExecuted.add(part.approvalId);
        }
        pending.delete(part.approvalId);
      }
    }
    if (pending.size === 0) break;
  }

  if (pending.size > 0) {
    throw new Error(
      `Approval request ${pending.values().next().value} was not found in the last ${APPROVAL_LOOKUP_MESSAGES} messages of thread ${threadId}`,
    );
  }

  return {
    requestMessageId: requestMessageId!,
    message: {
      role: "tool",
      content: decisions.map(({ approvalId, approved, reason }) => ({
        type: "tool-approval-response",
        approvalId,
        approved,
        reason,
        ...(providerExecuted.has(approvalId) ? { providerExecuted: true } : {}),
      })),
    },
  };
}
