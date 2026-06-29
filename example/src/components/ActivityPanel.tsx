import { RefreshCcw, X } from "lucide-react";

import { buildActivityRows } from "../state/activityRows";
import { formatTime, shortId } from "../lib/format";
import { JsonBlock } from "../lib/json";
import { cn } from "../lib/utils";
import { button, buttonSecondary, iconButton, label, panel, panelHeader } from "../lib/ui";
import type { ActivityRow, AgentRun, StreamState } from "../state/types";

export const ACTIVITY_WIDTH_KEY = "convex-agent:activity-width";
export const ACTIVITY_DEFAULT_WIDTH = 380;
export const ACTIVITY_MIN_WIDTH = 300;
export const ACTIVITY_MAX_WIDTH = 560;

const activityDotBase =
  "w-2 h-2 mt-[7px] rounded-full bg-blue-200 shadow-[0_0_0_4px_rgba(99,168,248,0.12)]";

const activityDotVariant: Record<string, string> = {
  success: "bg-green-200 shadow-[0_0_0_4px_rgba(180,236,146,0.1)]",
  closed: "bg-green-200 shadow-[0_0_0_4px_rgba(180,236,146,0.1)]",
  failed: "bg-red-200 shadow-[0_0_0_4px_rgba(255,202,193,0.1)]",
  error: "bg-red-200 shadow-[0_0_0_4px_rgba(255,202,193,0.1)]",
};

export function ActivityPanel({
  activity,
  readStream,
  run,
  stream,
  streamUrl,
  onClose,
}: {
  activity: ActivityRow[] | undefined;
  readStream?: () => void;
  run: AgentRun | null | undefined;
  stream: StreamState;
  streamUrl: string | undefined;
  onClose: () => void;
}) {
  const rows: ActivityRow[] = buildActivityRows({ activity, stream, streamUrl });
  return (
    <aside
      className={cn(
        panel,
        "grid grid-rows-[auto_minmax(0,1fr)_auto] min-w-0 min-h-0 overflow-hidden max-[760px]:min-h-[360px]",
      )}
      aria-label="Activity details"
    >
      <header className={panelHeader}>
        <div>
          <span className={label}>Run timeline</span>
          <h2 className="text-content-primary text-[17px] font-[650]">Activity</h2>
        </div>
        <button className={iconButton} type="button" aria-label="Close activity" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="app-scroll grid content-start min-h-0 overflow-auto px-3 py-[10px] bg-background-primary">
        {rows.map((row, index) => (
          <ActivityTimelineRow row={row} key={`${row.label}:${index}`} />
        ))}
      </div>
      <footer className="grid gap-[10px] border-t border-edge-transparent px-3 pt-[10px] pb-3">
        <details>
          <summary className="w-fit text-content-tertiary cursor-pointer text-[12px] list-none marker:hidden [&::-webkit-details-marker]:hidden">
            Run details
          </summary>
          <RunSummary run={run} />
        </details>
        <button
          className={cn(button, buttonSecondary)}
          type="button"
          disabled={!readStream}
          onClick={readStream}
        >
          <RefreshCcw size={14} />
          Replay stream
        </button>
      </footer>
    </aside>
  );
}

export function ActivityResizeHandle({
  commitWidth,
  resetWidth,
  setWidth,
  width,
}: {
  commitWidth: (value: number) => void;
  resetWidth: () => void;
  setWidth: (value: number) => void;
  width: number;
}) {
  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    document.body.classList.add("resizingActivity");

    function move(nextEvent: PointerEvent) {
      setWidth(startWidth - (nextEvent.clientX - startX));
    }

    function stop(nextEvent: PointerEvent) {
      const nextWidth = startWidth - (nextEvent.clientX - startX);
      setWidth(nextWidth);
      commitWidth(nextWidth);
      target.releasePointerCapture(nextEvent.pointerId);
      document.body.classList.remove("resizingActivity");
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
    }

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  }

  function nextWidthFor(key: string): number | null {
    if (key === "ArrowLeft") return width + 24;
    if (key === "ArrowRight") return width - 24;
    if (key === "Home") return ACTIVITY_MIN_WIDTH;
    if (key === "End") return ACTIVITY_MAX_WIDTH;
    return null;
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    const next = nextWidthFor(event.key);
    if (next !== null) {
      event.preventDefault();
      setWidth(next);
      commitWidth(next);
    }
  }

  return (
    <button
      aria-label="Resize activity panel"
      aria-orientation="vertical"
      aria-valuemax={ACTIVITY_MAX_WIDTH}
      aria-valuemin={ACTIVITY_MIN_WIDTH}
      aria-valuenow={Math.round(width)}
      className="group relative w-[12px] min-w-[12px] h-full p-0 border-0 bg-transparent cursor-col-resize outline-none max-[760px]:hidden"
      role="separator"
      title="Drag to resize Activity. Double-click to reset."
      type="button"
      onDoubleClick={resetWidth}
      onKeyDown={resizeWithKeyboard}
      onPointerDown={beginResize}
    >
      <div className="absolute top-[calc(50%-27px)] left-[5px] w-[2px] h-[54px] rounded-full bg-transparent group-hover:bg-[rgba(173,210,255,0.48)] group-focus-visible:bg-[rgba(173,210,255,0.48)]" />
    </button>
  );
}

function ActivityTimelineRow({ row }: { row: ActivityRow }) {
  return (
    <article className="grid grid-cols-[18px_minmax(0,1fr)] gap-[10px] pt-[7px] pb-[13px] border-b border-edge-transparent bg-transparent transition-colors duration-100">
      <span className={cn(activityDotBase, activityDotVariant[row.status])} />
      <div>
        <div className="flex items-center justify-between gap-3 min-h-[24px]">
          <strong className="text-[13px]">{row.label}</strong>
          <span className="text-content-tertiary text-[12px]">
            {row.timestamp ? formatTime(row.timestamp) : row.status}
          </span>
        </div>
        {row.detail !== undefined ? (
          <details className="mt-[6px]">
            <summary className="text-content-tertiary cursor-pointer text-[12px]">Raw detail</summary>
            <JsonBlock value={row.detail} />
          </details>
        ) : null}
      </div>
    </article>
  );
}

function RunSummary({ run }: { run: AgentRun | null | undefined }) {
  return (
    <div className="grid grid-cols-3 gap-[6px] mt-[8px]">
      <SummaryItem label="Run" value={shortId(run?.runId)} />
      <SummaryItem label="Thread" value={shortId(run?.threadId)} />
      <SummaryItem label="Stream" value={shortId(run?.streamId)} />
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-[3px]">
      <span className="text-content-tertiary font-display text-[10px] font-semibold tracking-[0.08em] uppercase">
        {label}
      </span>
      <code className="min-w-0 overflow-hidden text-content-secondary text-[12px] text-ellipsis">
        {value}
      </code>
    </div>
  );
}
