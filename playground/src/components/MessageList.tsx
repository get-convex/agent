import React, { useMemo, useRef, useEffect, useState } from "react";
import UIMessageItem from "./UIMessageItem";
import MessageDocItem from "./MessageDocItem";
import { Message, User } from "../types";
import { toUIMessages } from "@convex-dev/agent/react";
import { Button } from "@/components/ui/button";
import { List, Layers } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MessageListProps {
  users: User[];
  messages: Message[];
  selectedMessageId: string | undefined;
  onSelectMessage: (messageId: string) => void;
}

const MessageList: React.FC<MessageListProps> = ({
  users,
  messages,
  selectedMessageId,
  onSelectMessage,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<"raw" | "ui">("raw");

  const uiMessages = useMemo(() => {
    // TODO: segment the messages by "order" so the message item can show all of
    // the messages that have been grouped together. Right now you can only see
    // the latest message in the group / send messages to it.
    const uiMessages = toUIMessages(messages);
    return uiMessages.map((uiMessage) => {
      const message =
        messages.find((message) => message._id === uiMessage.id) ??
        messages.find((m) => m.id === uiMessage.id)!;
      uiMessage.id = message._id;
      return { ...message, message: uiMessage };
    });
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]); // Add messages as a dependency

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* View mode toggle */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <span className="text-xs text-muted-foreground">
          {viewMode === "raw"
            ? `${messages.length} messages (raw)`
            : `${uiMessages.length} messages (grouped)`}
        </span>
        <TooltipProvider>
          <div className="flex gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "raw" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setViewMode("raw")}
                >
                  <List size={14} className="mr-1" />
                  Raw
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Show all thread messages separately with full data</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "ui" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setViewMode("ui")}
                >
                  <Layers size={14} className="mr-1" />
                  Grouped
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Show messages grouped as UIMessages (may hide some data)</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === "raw"
          ? messages.map((message) => (
              <MessageDocItem
                key={message._id}
                user={users.find((user) => user._id === message.userId)}
                message={message}
                isSelected={message._id === selectedMessageId}
                onClick={() => {
                  onSelectMessage(message._id);
                }}
              />
            ))
          : uiMessages.map((message) => (
              <UIMessageItem
                key={message._id}
                user={users.find((user) => user._id === message.userId)}
                message={message}
                isSelected={message._id === selectedMessageId}
                onClick={() => {
                  onSelectMessage(message._id);
                }}
              />
            ))}
        {/* Add an invisible div at the bottom to scroll to */}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default MessageList;
