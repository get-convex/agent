import React, { useMemo, useRef, useEffect } from "react";
import MessageItem from "./MessageItem";
import { Message, User } from "../types";
import { toUIMessages } from "@convex-dev/agent/react";

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
    <div className="flex flex-col min-h-0 h-full overflow-y-auto">
      {uiMessages.map((message) => (
        <MessageItem
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
  );
};

export default MessageList;
