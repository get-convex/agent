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
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface MessageDocItemProps {
  user: User | undefined;
  message: Message;
  isSelected: boolean;
  onClick: React.MouseEventHandler<HTMLDivElement>;
}

const MessageDocItem: React.FC<MessageDocItemProps> = ({
  user,
  message,
  isSelected,
  onClick,
}) => {
  const [expanded, setExpanded] = useState(false);

  const messageDate = new Date(message._creationTime);
  const relativeTime = formatDistanceToNow(messageDate, { addSuffix: true });

  const role = message.message?.role;
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const isTool = role === "tool";
  const isSystem = role === "system";

  const toggleExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  // Get status icon and color
  const getStatusInfo = () => {
    switch (message.status) {
      case "success":
        return {
          icon: <CheckCircle size={12} />,
          color: "text-green-600",
          bgColor: "bg-green-100",
        };
      case "failed":
        return {
          icon: <AlertCircle size={12} />,
          color: "text-red-600",
          bgColor: "bg-red-100",
        };
      case "pending":
        return {
          icon: <Clock size={12} />,
          color: "text-yellow-600",
          bgColor: "bg-yellow-100",
        };
      default:
        return {
          icon: null,
          color: "text-gray-600",
          bgColor: "bg-gray-100",
        };
    }
  };

  const statusInfo = getStatusInfo();

  // Get role icon
  const getRoleIcon = () => {
    if (isUser) {
      return (
        <div className="w-6 h-6 flex items-center justify-center rounded-full bg-primary text-primary-foreground">
          <UserIcon size={14} />
        </div>
      );
    }
    if (isAssistant) {
      return (
        <div className="w-6 h-6 flex items-center justify-center rounded-full bg-ai text-white">
          <Bot size={14} />
        </div>
      );
    }
    if (isTool) {
      return (
        <div className="w-6 h-6 flex items-center justify-center rounded-full bg-muted-foreground text-muted">
          <Wrench size={14} />
        </div>
      );
    }
    if (isSystem) {
      return (
        <div className="w-6 h-6 flex items-center justify-center rounded-full bg-purple-500 text-white">
          <Zap size={14} />
        </div>
      );
    }
    return null;
  };

  // Get role label
  const getRoleLabel = () => {
    if (isUser) return user?.name ?? "User";
    if (isAssistant) return message.agentName ?? "Assistant";
    if (isTool) return "Tool Result";
    if (isSystem) return "System";
    return "Unknown";
  };

  // Extract text content preview
  const getTextPreview = () => {
    if (message.text) {
      return message.text.length > 200
        ? message.text.substring(0, 200) + "..."
        : message.text;
    }
    if (
      message.message?.content &&
      typeof message.message.content === "string"
    ) {
      const content = message.message.content;
      return content.length > 200 ? content.substring(0, 200) + "..." : content;
    }
    return null;
  };

  // Get tool info if this is a tool message
  const getToolInfo = () => {
    if (!message.message) return null;
    const content = message.message.content;
    if (typeof content === "string") return null;

    const toolCalls = content?.filter(
      (p): p is { type: "tool-call"; toolName: string; toolCallId: string } =>
        p.type === "tool-call",
    );
    const toolResults = content?.filter(
      (p): p is { type: "tool-result"; toolName: string; toolCallId: string } =>
        p.type === "tool-result",
    );

    return { toolCalls, toolResults };
  };

  const toolInfo = getToolInfo();
  const textPreview = getTextPreview();

  return (
    <div
      className={`p-3 border-b cursor-pointer transition-colors ${
        message.status === "failed"
          ? "bg-red-50 border-red-200"
          : isSelected
            ? "bg-secondary"
            : "hover:bg-muted/50"
      }`}
      onClick={onClick}
    >
      {/* Header row */}
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          {getRoleIcon()}
          <span className="font-medium text-sm">{getRoleLabel()}</span>
          <Badge variant="outline" className="text-xs px-1.5 py-0">
            {role ?? "unknown"}
          </Badge>
          {message.tool && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              <Wrench size={10} className="mr-1" />
              tool
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <span
                  className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${statusInfo.bgColor} ${statusInfo.color}`}
                >
                  {statusInfo.icon}
                  {message.status}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Status: {message.status}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="text-xs text-muted-foreground">{relativeTime}</span>
        </div>
      </div>

      {/* Metadata badges row */}
      <div className="flex flex-wrap gap-1.5 mb-2 ml-8">
        <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
          order: {message.order}
        </Badge>
        <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
          step: {message.stepOrder}
        </Badge>
        {message.model && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            {message.model}
          </Badge>
        )}
        {message.provider && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            {message.provider}
          </Badge>
        )}
        {message.usage?.totalTokens && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            {message.usage.totalTokens} tokens
          </Badge>
        )}
        {message.finishReason && (
          <Badge
            variant={
              message.finishReason === "tool-calls" ? "default" : "secondary"
            }
            className="text-[10px] px-1 py-0"
          >
            {message.finishReason}
          </Badge>
        )}
      </div>

      {/* Content preview */}
      <div className="ml-8">
        {/* Tool calls/results info */}
        {toolInfo?.toolCalls && toolInfo.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {toolInfo.toolCalls.map((tc) => (
              <Badge key={tc.toolCallId} variant="default" className="text-xs">
                <Wrench size={10} className="mr-1" />
                {tc.toolName}
              </Badge>
            ))}
          </div>
        )}

        {toolInfo?.toolResults && toolInfo.toolResults.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {toolInfo.toolResults.map((tr) => (
              <Badge
                key={tr.toolCallId}
                variant="secondary"
                className="text-xs"
              >
                <CheckCircle size={10} className="mr-1" />
                {tr.toolName} result
              </Badge>
            ))}
          </div>
        )}

        {/* Text preview */}
        {textPreview && (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">
            {textPreview}
          </div>
        )}

        {/* Error message */}
        {message.error && (
          <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
            <span className="font-medium">Error:</span> {message.error}
          </div>
        )}

        {/* Expand/collapse button */}
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-6 text-xs px-2"
          onClick={toggleExpanded}
        >
          {expanded ? (
            <>
              <ChevronUp size={12} className="mr-1" /> Hide Details
            </>
          ) : (
            <>
              <ChevronDown size={12} className="mr-1" /> Show Details
            </>
          )}
        </Button>

        {/* Expanded details - full message document JSON */}
        {expanded && (
          <div className="mt-3">
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto max-h-96 overflow-y-auto">
              {JSON.stringify(message, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageDocItem;
