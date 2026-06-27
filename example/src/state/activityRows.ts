import type { ActivityRow, StreamState } from "./types";

export const STREAM_ROW_LABEL = "HTTP stream";

function streamStatus(state: StreamState["state"]): string {
  switch (state) {
    case "live":
      return "streaming";
    case "connecting":
      return "connecting";
    case "closed":
      return "closed";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

/**
 * Merges backend run activity with a single consolidated HTTP-stream lifecycle row.
 * Any stream rows already present are dropped first, so the timeline shows exactly one
 * stream row regardless of how often we re-render. Raw IDs/headers/chunks live in the
 * row's `detail`, behind the existing "Raw detail" disclosure.
 */
export function buildActivityRows({
  activity,
  stream,
  streamUrl,
}: {
  activity: ActivityRow[] | undefined;
  stream: StreamState;
  streamUrl?: string;
}): ActivityRow[] {
  const backendRows = (activity ?? []).filter(
    (row) => row.label !== STREAM_ROW_LABEL,
  );
  return [
    ...backendRows,
    {
      label: STREAM_ROW_LABEL,
      status: streamStatus(stream.state),
      detail: { url: streamUrl, ...stream },
    },
  ];
}
