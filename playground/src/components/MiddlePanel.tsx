import React from "react";
import MessageList from "./MessageList";
import { Agent, Message, User } from "../types";
import MessageComposer from "./MessageComposer";
import { ContextOptions, MessageDoc, StorageOptions } from "@convex-dev/agent";

interface MiddlePanelProps {
  agents: Agent[] | undefined;
  users: User[];
  messages: Message[];
  selectedMessageId: string | undefined;
  selectedAgent: Agent | undefined;
  setSelectedAgent: (agent: Agent) => void;
  onSelectMessage: (messageId: string) => void;
  contextOptions: ContextOptions;
  setContextOptions: (contextOptions: ContextOptions) => void;
  storageOptions: StorageOptions;
  setStorageOptions: (storageOptions: StorageOptions) => void;
  onSendMessage: (
    message: string,
    agentName: string,
    context: ContextOptions | undefined,
    storage: StorageOptions | undefined,
    instructions?: string,
  ) => Promise<{ text: string; messages: MessageDoc[] } | undefined>;
  selectedThreadTitle?: string;
}

const MiddlePanel: React.FC<MiddlePanelProps> = ({
  agents,
  users,
  messages,
  selectedMessageId,
  selectedAgent,
  setSelectedAgent,
  onSelectMessage,
  contextOptions,
  setContextOptions,
  storageOptions,
  setStorageOptions,
  onSendMessage,
  selectedThreadTitle,
}) => {
  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <h2 className="font-medium">
          {selectedThreadTitle || "Select a thread"}
        </h2>
      </div>

      <div className="panel-content">
        {messages.length > 0 ? (
          <MessageList
            users={users}
            messages={messages}
            selectedMessageId={selectedMessageId}
            onSelectMessage={onSelectMessage}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a thread to view messages
          </div>
        )}
      </div>
      <div className="border-t">
        <MessageComposer
          agents={agents}
          selectedAgent={selectedAgent}
          setSelectedAgent={setSelectedAgent}
          contextOptions={contextOptions}
          setContextOptions={setContextOptions}
          storageOptions={storageOptions}
          setStorageOptions={setStorageOptions}
          onSendMessage={onSendMessage}
        />
      </div>
    </div>
  );
};

export default MiddlePanel;
