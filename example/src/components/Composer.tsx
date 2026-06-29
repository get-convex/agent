import { ArrowUp, FileText, Loader2, Paperclip, Square, X } from "lucide-react";
import type { RefObject } from "react";

import { attachmentStatusLabel, extensionBadge } from "../lib/upload";
import { cn } from "../lib/utils";
import { callout, calloutError, iconButton, panel } from "../lib/ui";
import { isAttachable } from "../state/useFileUpload";
import type { UploadAttachment } from "../state/types";

const previewTone: Record<UploadAttachment["uploadState"], string> = {
  reading: "text-content-secondary bg-[rgba(30,28,26,0.72)]",
  uploading: "text-content-secondary bg-[rgba(30,28,26,0.72)]",
  ready: "text-blue-200 bg-[rgba(30,28,26,0.78)]",
  metadataOnly: "text-yellow-200 bg-[rgba(92,80,37,0.2)]",
  error: "text-content-error bg-[rgba(107,33,31,0.24)]",
};

export function Composer({
  attachments,
  error,
  fileInputRef,
  prompt,
  running,
  uploading,
  onFileSelected,
  onStop,
  removeAttachment,
  setPrompt,
  stoppable,
  submit,
}: {
  attachments: UploadAttachment[];
  error: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  prompt: string;
  running: boolean;
  uploading: boolean;
  onFileSelected: (file: File) => void;
  onStop: () => void;
  removeAttachment: (localId: string) => void;
  setPrompt: (value: string) => void;
  stoppable: boolean;
  submit: () => void;
}) {
  const attachmentsReady =
    attachments.length === 0 || attachments.every(isAttachable);
  const canSend = prompt.trim().length > 0 || attachments.some(isAttachable);
  const sendDisabled = !canSend || !attachmentsReady || uploading || running;
  const actionDisabled = running ? !stoppable : sendDisabled;
  return (
    <section
      className={cn(
        panel,
        "grid gap-2 rounded-[10px] p-[10px] transition-[border-color,box-shadow] duration-100 focus-within:border-[rgba(173,210,255,0.42)] focus-within:shadow-[0_0_0_3px_rgba(63,82,149,0.18)] max-[760px]:gap-[7px] max-[760px]:rounded-[9px] max-[760px]:p-[9px]",
      )}
    >
      {error ? (
        <div className={cn(callout, calloutError, "mb-0.5")}>{error}</div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="flex flex-wrap items-start gap-[9px] max-[760px]:flex-nowrap max-[760px]:gap-[7px] max-[760px]:overflow-x-auto max-[760px]:pb-0.5">
          {attachments.map((file) => (
            <article
              className={cn(
                "relative grid w-[118px] min-h-[106px] overflow-hidden rounded-lg border bg-[rgba(42,40,37,0.88)] text-content-secondary shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-[border-color,background-color] duration-100 hover:bg-[rgba(42,40,37,0.92)] max-[760px]:w-[94px] max-[760px]:min-h-[90px] max-[760px]:flex-[0_0_94px]",
                file.uploadState === "error"
                  ? "border-[rgba(255,202,193,0.3)] text-content-error"
                  : "border-edge-transparent hover:border-[rgba(225,215,205,0.38)]",
              )}
              key={file.localId}
              title={file.error ?? file.summary}
            >
              <div
                className={cn(
                  "grid h-[56px] place-items-center content-center gap-1 border-b border-edge-soft max-[760px]:h-[45px]",
                  previewTone[file.uploadState],
                )}
                aria-hidden
              >
                {file.uploadState === "reading" ||
                file.uploadState === "uploading" ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <FileText size={19} />
                )}
                <span className="max-w-[88px] overflow-hidden text-ellipsis whitespace-nowrap font-display text-[10px] font-[650] uppercase tracking-[0.08em] text-[rgba(173,210,255,0.72)]">
                  {extensionBadge(file.filename)}
                </span>
              </div>
              <div className="grid min-w-0 gap-[3px] px-[9px] py-2 max-[760px]:p-[7px]">
                <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-[650] leading-[1.2] text-content-primary">
                  {file.filename}
                </strong>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.2] text-content-tertiary">
                  {attachmentStatusLabel(file)}
                </span>
              </div>
              <button
                className="absolute right-[7px] top-[7px] grid h-[22px] w-[22px] place-items-center rounded-[6px] border border-[rgba(225,215,205,0.18)] bg-[rgba(30,28,26,0.88)] p-0 text-content-secondary transition-[background-color,color,border-color] duration-100 hover:border-[rgba(225,215,205,0.42)] hover:bg-[rgba(60,58,55,0.98)] hover:text-content-primary focus-visible:border-[rgba(225,215,205,0.42)] focus-visible:bg-[rgba(60,58,55,0.98)] focus-visible:text-content-primary focus-visible:outline-none [&_svg]:block max-[760px]:right-[5px] max-[760px]:top-[5px]"
                type="button"
                onClick={() => removeAttachment(file.localId)}
                aria-label={`Remove ${file.filename}`}
                title="Remove attachment"
              >
                <X size={14} />
              </button>
            </article>
          ))}
        </div>
      ) : null}
      <textarea
        aria-label="Message"
        className="max-h-[140px] min-h-[48px] resize-none border-0 bg-transparent text-[15px] leading-[1.45] text-content-primary outline-none placeholder:text-[rgba(185,177,170,0.55)] max-[760px]:max-h-[112px] max-[760px]:min-h-[64px]"
        placeholder="Reply to the customer..."
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!sendDisabled) submit();
          }
        }}
      />
      <div className="flex items-center gap-[7px]">
        <input
          className="hidden"
          ref={fileInputRef}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFileSelected(file);
          }}
        />
        <button
          className={cn(iconButton, "max-[760px]:h-9 max-[760px]:w-9")}
          disabled={uploading}
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
        >
          <Paperclip size={18} />
        </button>
        <button
          className="ml-auto inline-grid h-[38px] min-h-[38px] w-[38px] place-items-center rounded-full border-0 bg-[rgb(202,204,204)] text-background-deep hover:bg-white max-[760px]:h-[42px] max-[760px]:min-h-[42px] max-[760px]:w-[42px]"
          disabled={actionDisabled}
          type="button"
          onClick={running ? onStop : submit}
          title={running ? "Stop response" : "Send message"}
        >
          {running ? (
            stoppable ? (
              <Square size={18} />
            ) : (
              <Loader2 className="animate-spin" size={20} />
            )
          ) : (
            <ArrowUp size={21} />
          )}
        </button>
      </div>
    </section>
  );
}
