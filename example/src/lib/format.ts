export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatTime(value: number | undefined) {
  if (value === undefined) return "";
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shortId(value: string | undefined) {
  if (!value) return "none";
  return value.length > 10 ? `${value.slice(0, 5)}...${value.slice(-5)}` : value;
}

export function userFacingError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const quota = /Send quota exhausted\. Retry in ([^.]+)\./.exec(raw);
  if (quota) return `Send limit reached. Try again in ${quota[1]}.`;
  const provider = /Provider request failed[:.]?\s*(.*)$/i.exec(raw);
  if (provider?.[1]) return `Provider request failed: ${provider[1]}`;
  return raw
    .replace(/^\[CONVEX [^\]]+\]\s*/u, "")
    .replace(/\s*Called by client$/u, "")
    .trim();
}
