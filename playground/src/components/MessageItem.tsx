import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { Message, User } from "../types";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  Bot,
  User as UserIcon,
  Wrench,
  FileIcon,
} from "lucide-react";
import { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { SmoothText } from "@convex-dev/agent/react";

interface MessageItemProps {
  user: User | undefined;
  message: Omit<Message, "message"> & { message: UIMessage };
  isSelected: boolean;
  onClick: React.MouseEventHandler<HTMLDivElement>;
}

const MessageItem: React.FC<MessageItemProps> = ({
  user,
  message,
  isSelected,
  onClick,
}) => {
  const [expandedToolCall, setExpandedToolCall] = useState<string | null>(null);

  const messageDate = new Date(message._creationTime);
  const relativeTime = formatDistanceToNow(messageDate, { addSuffix: true });

  const toggleToolCall = (toolCallId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedToolCall(expandedToolCall === toolCallId ? null : toolCallId);
  };

  return (
    <div
      className={`p-4 border-b cursor-pointer ${
        message.status === "failed"
          ? "bg-red-100 border-red-400 text-red-800"
          : isSelected
            ? "bg-secondary"
            : "hover:bg-muted/50"
      }`}
      onClick={onClick}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          {message.message?.role === "user" ? (
            <>
              <div className="w-6 h-6 flex items-center justify-center rounded-full bg-primary text-primary-foreground">
                <UserIcon size={14} />
              </div>
              <span className="font-medium">{user?.name ?? "User"}</span>
            </>
          ) : (
            <>
              <div className="w-6 h-6 flex items-center justify-center rounded-full bg-ai text-white">
                <Bot size={14} />
              </div>
              <span className="font-medium text-ai">{message.agentName}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{relativeTime}</span>
          {message.usage?.totalTokens && (
            <span className="bg-secondary px-2 py-0.5 rounded-full">
              {message.usage.totalTokens} tokens
            </span>
          )}
        </div>
      </div>

      {message.text && (
        <div
          className={
            `${message.message?.role === "user" ? "message-bubble-user" : "message-bubble-agent"} whitespace-pre-wrap`
          }
        >
          <SmoothText
            text={message.text}
            startStreaming={message.status === "pending"}
          />
        </div>
      )}

      <div className="ml-6 mt-2">
        {message.message?.parts.map((part, i) => {
          if ("toolCallId" in part) {
            // dynamic tool & named tool
            return (
              <ToolCall
                key={part.toolCallId}
                part={part}
                expanded={expandedToolCall === part.toolCallId}
                toggleExpanded={(e) => toggleToolCall(part.toolCallId, e)}
              />
            );
          }
          switch (part.type) {
            case "reasoning":
              return (
                <div key={message._id + " reasoning " + i}>
                  <SmoothText
                    text={part.text}
                    startStreaming={part.state === "streaming"}
                  />
                  {part.state === "streaming" && <span>...</span>}
                </div>
              );
            case "source-url":
              return (
                <div key={message._id + " source " + i}>
                  <a href={part.url} target="_blank">
                    {part.title ?? part.url}
                  </a>
                </div>
              );
            case "source-document":
              return (
                <div key={message._id + " source " + i}>
                  Document {part.sourceId}: {part.title}: {part.mediaType}{" "}
                  {part.filename ? `(${part.filename})` : ""}
                </div>
              );
            case "file":
              return part.mediaType.startsWith("image/") ? (
                <div key={message._id + " file " + i} className="mt-2">
                  <img
                    src={part.url}
                    className="rounded-lg max-w-full max-h-[300px]"
                  />
                </div>
              ) : (
                <a key={i} className="mt-2" href={part.url} target="_blank">
                  <FileIcon size={14} />

                  <span>
                    {part.filename
                      ? `${part.filename} (${part.mediaType})`
                      : part.mediaType}
                  </span>
                  {(part.providerMetadata && (
                    <span className="text-xs text-muted-foreground">
                      {JSON.stringify(part.providerMetadata)}
                    </span>
                  )) ||
                    null}
                </a>
              );
          }
        })}
      </div>
    </div>
  );
};

export default MessageItem;

const ToolCall: React.FC<{
  part: ToolUIPart | DynamicToolUIPart;
  expanded: boolean;
  toggleExpanded: (e: React.MouseEvent) => void;
}> = ({ part, expanded, toggleExpanded }) => {
  const toolName =
    "toolName" in part
      ? part.toolName
      : part.type.startsWith("tool-")
        ? part.type.slice(5)
        : part.type;
  return (
    <div
      key={part.toolCallId + " " + part.state}
      className={`tool-call-bubble mt-2 ${
        expanded ? "bg-secondary border border-primary/30 rounded-lg" : ""
      }`}
    >
      <div
        className="flex items-center gap-2 p-2 cursor-pointer"
        onClick={toggleExpanded}
      >
        <div className="w-5 h-5 flex items-center justify-center rounded-full bg-muted-foreground text-muted">
          <Wrench size={12} />
        </div>
        <span className="font-medium text-sm">{toolName}</span>
        <Button
          variant="ghost"
          size="sm"
          className="p-0 h-5 w-5 ml-auto"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded(e);
          }}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </Button>
      </div>
      {expanded && (
        <div className="mt-2 text-sm p-2">
          <div className="mb-2">
            <div className="font-medium mb-1">
              State:
              <span>
                <pre className="bg-secondary p-2 rounded-md overflow-x-auto text-xs inline">
                  {part.state}
                </pre>
              </span>
            </div>
            <div className="font-medium mb-1">
              Type:
              <span>
                <pre className="bg-secondary p-2 rounded-md overflow-x-auto text-xs inline">
                  {part.type}
                </pre>
              </span>
            </div>
          </div>
          <div className="mb-2">
            <div className="font-medium mb-1">Arguments:</div>
            <pre className="bg-secondary p-2 rounded-md overflow-x-auto text-xs">
              {JSON.stringify(part.input, null, 2)}
            </pre>
            {part.state === "output-available" && (
              <>
                <div className="font-medium mb-1">Return Value:</div>
                <pre className="bg-secondary p-2 rounded-md overflow-x-auto text-xs">
                  {JSON.stringify(part.output, null, 2)}
                </pre>
              </>
            )}
            {part.state === "output-error" && (
              <>
                <div className="font-medium mb-1">Error:</div>
                <pre className="bg-secondary p-2 rounded-md overflow-x-auto text-xs">
                  {JSON.stringify(part.errorText, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
