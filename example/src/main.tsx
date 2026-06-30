import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ConvexProvider,
  ConvexReactClient,
  useMutation,
  useQuery,
} from "convex/react";
import { Activity, Plus } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { useChatTransport } from "@convex-dev/agent/vercel/react";

import { api } from "../convex/_generated/api";
import {
  ACTIVITY_DEFAULT_WIDTH,
  ACTIVITY_MAX_WIDTH,
  ACTIVITY_MIN_WIDTH,
  ACTIVITY_WIDTH_KEY,
  ActivityPanel,
  ActivityResizeHandle,
} from "./components/ActivityPanel";
import { ApprovalCard } from "./components/ApprovalCard";
import { Composer } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { clamp, userFacingError } from "./lib/format";
import { cn } from "./lib/utils";
import { button, buttonSecondary, iconButton, iconButtonActive } from "./lib/ui";
import { MissingConfig } from "./components/Setup";
import { useFileUpload } from "./state/useFileUpload";
import { useRunStream } from "./state/useRunStream";
import type { ToolCall } from "./state/types";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const configuredSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL as
  | string
  | undefined;

function inferSiteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(".convex.cloud", ".convex.site");
}

function readActivityWidth() {
  const stored = Number(readStorage(localStorage, ACTIVITY_WIDTH_KEY));
  return Number.isFinite(stored)
    ? clamp(stored, ACTIVITY_MIN_WIDTH, ACTIVITY_MAX_WIDTH)
    : ACTIVITY_DEFAULT_WIDTH;
}

const sessionIdKey = "convex-agent-session-id-v1";

function createSessionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isSessionId(value: string) {
  return value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

function readSessionId() {
  const existing = readStorage(sessionStorage, sessionIdKey);
  if (existing && isSessionId(existing)) return existing;
  const next = createSessionId();
  writeStorage(sessionStorage, sessionIdKey, next);
  return next;
}

function readStorage(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}

function App({ siteUrl }: { siteUrl: string | undefined }) {
  const [sessionId] = useState(readSessionId);
  const [prompt, setPrompt] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityWidth, setActivityWidth] = useState(readActivityWidth);
  const { readStream, resetStream, stream } = useRunStream(siteUrl, sessionId);
  const chat = useChat(
    useChatTransport(
      {
        list: api.support.chat.list,
        send: api.support.chat.send,
        read: api.support.chat.read,
        resume: api.support.chat.resume,
        cancel: api.support.chat.cancel,
      },
      { sessionId },
      { id: sessionId, cancelOnAbort: true },
    ),
  );
  const submitInFlightRef = useRef(false);

  const newCase = useMutation(api.support.cases.create);
  const generateUploadUrl = useMutation(api.support.files.generateUploadUrl);
  const saveUploadedFile = useMutation(api.support.files.saveUploaded);
  const approveToolCall = useMutation(api.support.tools.approve);
  const denyToolCall = useMutation(api.support.tools.deny);
  const upload = useFileUpload({
    sessionId,
    generateUploadUrl,
    saveUploadedFile,
    setError,
  });

  const activeCase = useQuery(api.support.cases.getActive, { sessionId });
  const activityRunId = activeRunId ?? activeCase?.lastRunId;
  const latestRun = useQuery(
    api.support.runs.get,
    activityRunId ? { sessionId, runId: activityRunId } : "skip",
  );
  const toolCalls = useQuery(
    api.support.tools.list,
    latestRun ? { sessionId, runId: latestRun.runId } : "skip",
  );
  const activity = useQuery(
    api.support.activity.list,
    activityOpen && latestRun ? { sessionId, runId: latestRun.runId } : "skip",
  );
  const streamUrl = useMemo(() => {
    if (!siteUrl || !latestRun) return undefined;
    const url = new URL("/agent/run", siteUrl);
    url.searchParams.set("runId", latestRun.runId);
    url.searchParams.set("sessionId", sessionId);
    return url.toString();
  }, [sessionId, latestRun, siteUrl]);
  function resizeActivity(nextWidth: number) {
    setActivityWidth(clamp(nextWidth, ACTIVITY_MIN_WIDTH, ACTIVITY_MAX_WIDTH));
  }

  function commitActivityWidth(nextWidth: number) {
    writeStorage(
      localStorage,
      ACTIVITY_WIDTH_KEY,
      String(Math.round(clamp(nextWidth, ACTIVITY_MIN_WIDTH, ACTIVITY_MAX_WIDTH))),
    );
  }

  function resetActivityWidth() {
    setActivityWidth(ACTIVITY_DEFAULT_WIDTH);
    commitActivityWidth(ACTIVITY_DEFAULT_WIDTH);
  }

  async function submitChat() {
    if (submitInFlightRef.current) return;
    const text = prompt.trim();
    if (!text && upload.attachments.length === 0) return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    const originalAttachments = upload.attachments;
    const fileRefs = upload.readyFileRefs();
    const clientMessageId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const promptToSend = text || "Please review the attached file.";
    setPrompt("");
    upload.clearAttachments();
    try {
      await chat.sendMessage({
        text: promptToSend,
        messageId: clientMessageId,
      }, {
        body: {
          clientMessageId,
          fileRefs,
        },
      });
    } catch (nextError) {
      const message = userFacingError(nextError);
      setError(message);
      setPrompt(text);
      upload.restoreAttachments(originalAttachments);
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  async function stopActiveRun() {
    if (chat.status !== "submitted" && chat.status !== "streaming") {
      return;
    }
    setError(null);
    try {
      chat.stop();
    } catch (nextError) {
      setError(userFacingError(nextError));
    }
  }

  async function startNewCase() {
    setError(null);
    setActiveRunId(null);
    resetStream();
    await newCase({ sessionId, title: "Support case" });
  }

  async function resolveToolCall(call: ToolCall, resolution: "approve" | "deny") {
    setError(null);
    try {
      const nextRun = await (resolution === "approve"
        ? approveToolCall({
            sessionId,
            runId: call.runId,
            toolCallId: call.toolCallId,
          })
        : denyToolCall({
            sessionId,
            runId: call.runId,
            toolCallId: call.toolCallId,
          }));
      setActiveRunId(nextRun.runId);
      void chat.resumeStream();
    } catch (nextError) {
      setError(userFacingError(nextError));
    }
  }

  const runIsDrafting =
    submitting ||
    chat.status === "submitted" ||
    chat.status === "streaming" ||
    latestRun?.status === "waiting";
  const canStopRun = chat.status === "submitted" || chat.status === "streaming";
  const waitingToolCall = (toolCalls ?? []).find(
    (call) => call.status === "waiting",
  );

  return (
    <div className="grid h-full min-h-screen grid-rows-[48px_minmax(0,1fr)] overflow-hidden bg-background-primary [height:100dvh] [min-height:100dvh] max-[760px]:grid-rows-[auto_minmax(0,1fr)]">
      <nav
        className="flex items-center justify-between gap-4 border-b border-edge-transparent bg-background-secondary px-[18px] max-[760px]:min-h-[52px] max-[760px]:flex-nowrap max-[760px]:gap-2 max-[760px]:py-2 max-[760px]:pl-[max(12px,env(safe-area-inset-left))] max-[760px]:pr-[max(12px,env(safe-area-inset-right))] max-[430px]:min-h-[50px]"
        aria-label="Support controls"
      >
        <div className="flex min-w-0 items-baseline gap-[10px] max-[760px]:flex-auto max-[760px]:gap-2 max-[760px]:overflow-hidden">
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-content-tertiary max-[760px]:hidden">
            Convex Agent
          </span>
          <strong className="text-[13px] font-[650] text-content-primary max-[760px]:overflow-hidden max-[760px]:text-ellipsis max-[760px]:whitespace-nowrap max-[760px]:text-[14px]">
            Support case
          </strong>
        </div>
        <div className="flex min-w-0 items-center gap-2 max-[760px]:flex-none max-[760px]:justify-end max-[760px]:gap-1.5">
          <button
            className={cn(
              button,
              buttonSecondary,
              "max-[760px]:min-h-[34px] max-[760px]:px-[9px] max-[760px]:text-[12px] max-[430px]:w-9 max-[430px]:px-0",
            )}
            type="button"
            onClick={startNewCase}
          >
            <Plus size={14} />
            <span className="max-[430px]:sr-only">New case</span>
          </button>
          <button
            className={cn(
              iconButton,
              "max-[760px]:min-h-[34px]",
              activityOpen && iconButtonActive,
            )}
            disabled={!latestRun}
            type="button"
            aria-label="Toggle activity"
            onClick={() => setActivityOpen((open) => !open)}
          >
            <Activity size={15} />
          </button>
        </div>
      </nav>

      <main className="grid min-h-0 overflow-hidden p-[18px] [place-items:stretch_center] max-[760px]:p-[10px] max-[760px]:pb-[max(10px,env(safe-area-inset-bottom))] max-[760px]:pl-[max(10px,env(safe-area-inset-left))] max-[760px]:pr-[max(10px,env(safe-area-inset-right))] max-[430px]:px-2">
        <section
          className={cn(
            "grid w-[min(100%,1360px)] min-w-0 min-h-0 justify-center max-[760px]:grid-cols-[minmax(0,1fr)] max-[760px]:gap-3",
            activityOpen
              ? "grid-cols-[minmax(0,1fr)_12px_minmax(300px,min(var(--activity-width),45vw))]"
              : "grid-cols-[minmax(0,940px)]",
          )}
          style={{ "--activity-width": `${activityWidth}px` } as React.CSSProperties}
        >
          <section className="grid min-w-0 min-h-0 grid-rows-[minmax(0,1fr)_auto_auto] gap-[10px] max-[760px]:w-full max-[760px]:gap-2 max-[760px]:overflow-hidden">
            <Conversation
              agentName={latestRun?.agentName}
              loading={activeCase === undefined}
              messages={chat.messages}
            />
            {waitingToolCall ? (
              <ApprovalCard
                call={waitingToolCall}
                approve={(call) => void resolveToolCall(call, "approve")}
                deny={(call) => void resolveToolCall(call, "deny")}
              />
            ) : null}
            <Composer
              attachments={upload.attachments}
              error={error}
              fileInputRef={upload.fileInputRef}
              prompt={prompt}
              running={runIsDrafting}
              stoppable={canStopRun}
              uploading={upload.uploading}
              onFileSelected={(file) => void upload.uploadFile(file)}
              onStop={() => void stopActiveRun()}
              removeAttachment={upload.removeAttachment}
              setPrompt={setPrompt}
              submit={submitChat}
            />
          </section>

          {activityOpen ? (
            <>
              <ActivityResizeHandle
                commitWidth={commitActivityWidth}
                width={activityWidth}
                setWidth={resizeActivity}
                resetWidth={resetActivityWidth}
              />
              <ActivityPanel
                activity={activity}
                readStream={latestRun ? () => void readStream(latestRun) : undefined}
                run={latestRun}
                stream={stream}
                streamUrl={streamUrl}
                onClose={() => setActivityOpen(false)}
              />
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    {convexUrl === undefined ? (
      <MissingConfig />
    ) : (
      <ConvexProvider client={new ConvexReactClient(convexUrl)}>
        <App siteUrl={configuredSiteUrl ?? inferSiteUrl(convexUrl)} />
      </ConvexProvider>
    )}
  </StrictMode>,
);
