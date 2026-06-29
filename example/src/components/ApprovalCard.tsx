import { Check, ShieldCheck, X } from "lucide-react";

import { JsonBlock } from "../lib/json";
import { cn } from "../lib/utils";
import { button, buttonAccent, buttonSecondary, panel } from "../lib/ui";
import type { ToolCall } from "../state/types";

export function ApprovalCard({
  call,
  approve,
  deny,
}: {
  call: ToolCall;
  approve: (call: ToolCall) => void;
  deny: (call: ToolCall) => void;
}) {
  return (
    <article
      className={cn(
        panel,
        "grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 p-3 max-[760px]:grid-cols-[34px_minmax(0,1fr)]",
      )}
    >
      <div className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[rgba(63,82,149,0.45)] text-blue-200">
        <ShieldCheck size={18} />
      </div>
      <div>
        <strong className="mb-[3px] block">Approval required</strong>
        <p className="text-[13px] text-content-secondary">
          The agent wants to run <code>{call.name}</code>.
        </p>
        <details className="mt-[7px]">
          <summary className="cursor-pointer text-[13px] text-content-secondary">
            Tool input
          </summary>
          <JsonBlock value={call.input} />
        </details>
      </div>
      <div className="flex flex-wrap gap-2 max-[760px]:col-start-2">
        <button
          className={cn(button, buttonAccent)}
          type="button"
          onClick={() => approve(call)}
        >
          <Check size={14} />
          Approve
        </button>
        <button
          className={cn(button, buttonSecondary)}
          type="button"
          onClick={() => deny(call)}
        >
          <X size={14} />
          Deny
        </button>
      </div>
    </article>
  );
}
