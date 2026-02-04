// Tool Approval Demo UI
// Demonstrates the AI SDK v6 tool approval workflow with approve/deny buttons
import { useMutation } from "convex/react";
import { Toaster } from "../components/ui/toaster";
import { api } from "../../convex/_generated/api";
import {
  optimisticallySendMessage,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useDemoThread } from "@/hooks/use-demo-thread";
import type { ToolUIPart } from "ai";

export default function ChatApproval() {
  const { threadId, resetThread } = useDemoThread("Tool Approval Demo");

  return (
    <>
      <header className="sticky top-0 h-16 z-10 bg-white/80 backdrop-blur-sm p-4 flex justify-between items-center border-b">
        <h1 className="text-xl font-semibold accent-text">
          Tool Approval Demo
        </h1>
      </header>
      <div className="h-[calc(100vh-8rem)] flex flex-col bg-gray-50">
        {threadId ? (
          <ApprovalChat threadId={threadId} reset={() => void resetThread()} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Loading...
          </div>
        )}
        <Toaster />
      </div>
    </>
  );
}

function ApprovalChat({
  threadId,
  reset,
}: {
  threadId: string;
  reset: () => void;
}) {
  const {
    results: messages,
    status,
    loadMore,
  } = useUIMessages(
    api.chat.approval.listThreadMessages,
    { threadId },
    { initialNumItems: 10, stream: true },
  );

  const sendMessage = useMutation(
    api.chat.approval.sendMessage,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.approval.listThreadMessages),
  );

  const submitApproval = useMutation(api.chat.approval.submitApproval);

  const [prompt, setPrompt] = useState("Delete the file important.txt");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);


  function onSendClicked() {
    if (prompt.trim() === "") return;
    void sendMessage({ threadId, prompt }).catch(() => setPrompt(prompt));
    setPrompt("");
  }

  const handleApproval = async (
    approvalId: string,
    toolCallId: string,
    toolName: string,
    args: unknown,
    parentMessageId: string,
    approved: boolean
  ) => {
    try {
      await submitApproval({
        threadId,
        toolCallId,
        toolName,
        args,
        parentMessageId,
        approvalId,
        approved,
        reason: approved ? "User approved" : "User denied",
      });
    } catch (error) {
      console.error("[handleApproval] error:", error);
    }
  };

  return (
    <>
      <div className="h-full flex flex-col max-w-4xl mx-auto w-full">
        {/* Info banner */}
        <div className="bg-blue-50 border-b border-blue-200 p-4 text-sm text-blue-800">
          <strong>Try these prompts:</strong>
          <ul className="mt-1 list-disc list-inside">
            <li>"Delete the file important.txt" (always requires approval)</li>
            <li>"Transfer $50 to account ABC123" (no approval needed)</li>
            <li>"Transfer $500 to account XYZ789" (requires approval for {">"} $100)</li>
            <li>"Check the balance of account TEST001" (no approval needed)</li>
          </ul>
        </div>

        {/* Messages area - scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length > 0 ? (
            <div className="flex flex-col gap-4">
              {status === "CanLoadMore" && (
                <button
                  onClick={() => loadMore(4)}
                  className="text-blue-600 hover:underline"
                >
                  Load more
                </button>
              )}
              {messages.map((m) => (
                <Message
                  key={m.key}
                  message={m}
                  onApproval={handleApproval}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Try a prompt that triggers tool approval...
            </div>
          )}
        </div>

        {/* Fixed input area at bottom */}
        <div className="border-t bg-white p-6">
          <form
            className="flex gap-2 items-center max-w-2xl mx-auto"
            onSubmit={(e) => {
              e.preventDefault();
              onSendClicked();
            }}
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
              placeholder="Ask me to do something that requires approval..."
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition font-semibold disabled:opacity-50"
              disabled={!prompt.trim()}
            >
              Send
            </button>
            {messages.length > 0 && (
              <button
                className="px-4 py-2 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 transition font-medium"
                onClick={() => {
                  reset();
                  setPrompt("");
                }}
                type="button"
              >
                Reset
              </button>
            )}
          </form>
        </div>
      </div>
    </>
  );
}

// Helper to extract tool name from type (e.g., "tool-deleteFile" -> "deleteFile")
function getToolName(type: string): string {
  return type.replace("tool-", "");
}

function Message({
  message,
  onApproval,
}: {
  message: UIMessage;
  onApproval: (
    approvalId: string,
    toolCallId: string,
    toolName: string,
    args: unknown,
    parentMessageId: string,
    approved: boolean
  ) => void;
}) {
  const isUser = message.role === "user";

  // Render parts in order to show approval UI in the correct position
  const renderPart = (part: UIMessage["parts"][number], index: number) => {
    // Skip step-start parts (visual separator, not needed here)
    if (part.type === "step-start") {
      return null;
    }

    // Text part
    if (part.type === "text") {
      const textPart = part as { text: string; state?: string };
      return (
        <div key={index} className="whitespace-pre-wrap">
          {textPart.text}
          {textPart.state === "streaming" && (
            <span className="animate-pulse">▋</span>
          )}
        </div>
      );
    }

    // Tool part
    if (part.type.startsWith("tool-")) {
      const tool = part as ToolUIPart;
      const approvalId = "approval" in tool ? (tool.approval as { id?: string })?.id : undefined;

      // Pending approval
      if (tool.state === "approval-requested" && approvalId) {
        return (
          <div
            key={tool.toolCallId}
            className="my-3 p-3 bg-orange-100 border-2 border-orange-500 rounded-lg"
          >
            <div className="font-semibold text-yellow-800 mb-2">
              ⚠️ Approval Required: {getToolName(tool.type)}
            </div>
            <div className="text-sm text-yellow-700 mb-3">
              <strong>Action:</strong>{" "}
              {JSON.stringify(tool.input, null, 2)}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onApproval(
                  approvalId,
                  tool.toolCallId,
                  getToolName(tool.type),
                  tool.input,
                  message.id,
                  true
                )}
                className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition text-sm font-medium"
              >
                ✓ Approve
              </button>
              <button
                type="button"
                onClick={() => onApproval(
                  approvalId,
                  tool.toolCallId,
                  getToolName(tool.type),
                  tool.input,
                  message.id,
                  false
                )}
                className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition text-sm font-medium"
              >
                ✗ Deny
              </button>
            </div>
          </div>
        );
      }

      // Completed tool
      if (tool.state === "output-available" || tool.state === "approval-responded") {
        return (
          <div
            key={tool.toolCallId}
            className="my-3 p-3 bg-green-50 border border-green-300 rounded-lg"
          >
            <div className="font-semibold text-green-800">
              ✓ {getToolName(tool.type)}
            </div>
            <div className="text-sm text-green-700 mt-1">
              <strong>Input:</strong> {JSON.stringify(tool.input)}
            </div>
            {"output" in tool && tool.output != null ? (
              <div className="text-sm text-green-700 mt-1">
                <strong>Output:</strong> {String(tool.output)}
              </div>
            ) : null}
          </div>
        );
      }

      // Denied tool
      if (tool.state === "output-denied") {
        return (
          <div
            key={tool.toolCallId}
            className="my-3 p-3 bg-red-50 border border-red-300 rounded-lg"
          >
            <div className="font-semibold text-red-800">
              ✗ Denied: {getToolName(tool.type)}
            </div>
            <div className="text-sm text-red-700 mt-1">
              <strong>Action:</strong> {JSON.stringify(tool.input)}
            </div>
          </div>
        );
      }

      // Tool in other states (input-available, input-streaming, etc.)
      return (
        <div
          key={tool.toolCallId}
          className="my-3 p-3 bg-gray-100 border border-gray-300 rounded-lg"
        >
          <div className="font-semibold text-gray-700">
            🔧 {getToolName(tool.type)}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            <strong>Input:</strong> {JSON.stringify(tool.input)}
          </div>
          {tool.state === "input-streaming" && (
            <div className="text-xs text-gray-500 mt-1 animate-pulse">
              Processing...
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "rounded-lg px-4 py-3 max-w-xl shadow-sm transition-all duration-200",
          isUser ? "bg-blue-100 text-blue-900" : "bg-gray-200 text-gray-800",
          {
            "bg-green-100": message.status === "streaming",
            "bg-red-100": message.status === "failed",
          },
        )}
      >
        {/* Render parts in order */}
        {message.parts.map((part, index) => renderPart(part, index))}

        {/* Status indicator */}
        {message.status === "streaming" && !message.parts.some(p => p.type === "text" && (p as { state?: string }).state === "streaming") && (
          <div className="mt-2 text-xs text-gray-500 animate-pulse">
            Generating...
          </div>
        )}
      </div>
    </div>
  );
}
