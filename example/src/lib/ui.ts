export const label =
  "block mb-[5px] font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-content-tertiary";

const interactiveBase =
  "inline-flex items-center justify-center gap-[7px] min-h-8 rounded-[7px] border text-[13px] font-semibold leading-none transition-[background-color,border-color,color] duration-100";

export const button = `${interactiveBase} border-transparent bg-transparent px-[10px] text-content-secondary`;

export const buttonAccent = "border-white/[0.22] bg-util-accent text-content-primary";

export const buttonSecondary =
  "border-edge-transparent hover:bg-background-tertiary hover:text-content-primary";

export const iconButton = `${interactiveBase} w-[34px] border-edge-transparent bg-transparent p-0 text-content-secondary hover:bg-background-tertiary hover:text-content-primary`;

export const iconButtonActive = "bg-background-tertiary text-content-primary";

export const chip =
  "inline-flex items-center gap-[6px] min-h-[24px] rounded-[6px] border border-edge-transparent bg-background-tertiary px-2 text-[12px] font-semibold leading-none text-content-secondary";

export const evidenceChip =
  "max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap border-[rgba(99,168,248,0.3)] bg-[rgba(63,82,149,0.28)] text-blue-200";

export const callout =
  "flex gap-2 rounded-lg border border-edge-transparent px-[11px] py-[9px] text-[13px] leading-[1.45]";

export const calloutError =
  "border-[rgba(255,202,193,0.3)] bg-[rgba(107,33,31,0.58)] text-content-error";

export const panel =
  "rounded-lg border border-edge-transparent bg-background-secondary";

export const panelHeader =
  "flex items-center justify-between gap-3 min-h-[54px] border-b border-edge-transparent px-3 py-[10px]";

export const codeBlock =
  "app-scroll block overflow-auto rounded-[6px] border border-edge-soft bg-background-deep p-[10px] font-mono text-[12px] leading-[1.5] whitespace-pre text-content-secondary";

export const caret =
  "inline-block w-[7px] h-[1.05em] ml-0.5 rounded-[1px] bg-content-secondary align-text-bottom translate-y-[2px] animate-blink";

export const prose =
  "grid gap-2 text-[15px] leading-[1.65] text-content-secondary";

export const bubbleText =
  "grid gap-2 mt-[5px] rounded-[15px_15px_4px_15px] border border-edge-soft bg-[rgba(63,82,149,0.58)] px-[13px] py-[9px] text-[14px] leading-[1.55] text-content-primary";
