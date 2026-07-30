import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CollapsibleSection from "./CollapsibleSection";
import JsonEditor from "./JsonEditor";
import {
  MessageDoc,
  ContextOptions,
  StorageOptions,
  vContextOptions,
  vStorageOptions,
} from "@convex-dev/agent";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Agent } from "@/types";
import MessageList from "./MessageList";
import {
  instructionOverrideForAgent,
  updateInstructionOverride,
  type AgentInstructionOverride,
} from "./agentInstructionOverride";

interface MessageComposerProps {
  agents: Agent[] | undefined;
  selectedAgent: Agent | undefined;
  setSelectedAgent: (agent: Agent) => void;
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
}

const MessageComposer: React.FC<MessageComposerProps> = ({
  agents,
  selectedAgent,
  setSelectedAgent,
  contextOptions,
  setContextOptions,
  storageOptions,
  setStorageOptions,
  onSendMessage,
}) => {
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<string | null | MessageDoc[]>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [instructionOverride, setInstructionOverride] = useState<
    AgentInstructionOverride | undefined
  >(undefined);
  const activeInstructionOverride = instructionOverrideForAgent(
    instructionOverride,
    selectedAgent?.name,
  );
  const isInstructionOverrideDirty = activeInstructionOverride !== undefined;
  const handleResetInstructions = () => {
    setInstructionOverride(undefined);
  };

  const handleInstructionsChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setInstructionOverride(
      updateInstructionOverride(
        selectedAgent?.name,
        selectedAgent?.editableInstructions,
        e.target.value,
      ),
    );
  };

  const handleSend = async () => {
    if (!message.trim() || !selectedAgent) {
      toast.error("Please enter a message and select an agent");
      return Promise.reject();
    }
    setIsSendingMessage(true);
    setResponse("Sending...");
    try {
      const response = await onSendMessage(
        message,
        selectedAgent.name,
        contextOptions,
        storageOptions,
        activeInstructionOverride,
      );
      if (!response || storageOptions.saveMessages !== "none") {
        setResponse(null);
      } else if (!response.messages?.length) {
        setResponse(response.text);
      } else {
        setResponse(response.messages);
      }
    } catch (e) {
      console.error(e);
      const error = e instanceof Error ? e.message : (e as object).toString();
      toast.error("Error sending message", { description: error });
      setResponse("Error: " + error);
    } finally {
      setIsSendingMessage(false);
    }
  };

  return (
    <>
      {response && (
        <div className="border rounded-md p-3 bg-muted/50">
          <h3 className="font-medium mb-2 text-sm">Response:</h3>
          {Array.isArray(response) ? (
            <MessageList
              messages={response}
              users={[]}
              selectedMessageId={undefined}
              onSelectMessage={() => {}}
            />
          ) : (
            <p className="text-sm">{response}</p>
          )}
        </div>
      )}
      <div className="flex flex-row gap-4 p-4 bg-muted/30 rounded-lg items-start">
        <div className="mb-0 w-full flex flex-col justify-center">
          <Textarea
            placeholder="Type your message here..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend().then(() => {
                  setMessage("");
                });
              }
            }}
            className="min-h-[100px]"
          />
        </div>
        <div className="flex flex-col gap-4 content-around items-stretch min-w-[200px]">
          <div className="flex flex-col">
            <Select
              value={selectedAgent?.name || ""}
              onValueChange={(value) => {
                const agent = agents?.find((a) => a.name === value);
                if (agent) {
                  setSelectedAgent(agent);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {agents?.map((agent) => (
                  <SelectItem key={agent.name} value={agent.name}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="mt-2"
            onClick={handleSend}
            disabled={!message.trim() || !selectedAgent || isSendingMessage}
            title={
              !message.trim()
                ? "Please enter a message"
                : !selectedAgent
                  ? "Please select an agent"
                  : isSendingMessage
                    ? "Sending..."
                    : "Send Message"
            }
          >
            {isSendingMessage ? "Sending..." : "Send Message"}
          </Button>
        </div>
      </div>
      <div className="px-4 bg-muted/30 rounded-lg">
        <CollapsibleSection title="System Prompt">
          <div className="flex flex-row gap-2 items-end relative">
            <div className="w-full">
              <Textarea
                aria-label="System prompt"
                value={
                  activeInstructionOverride ??
                  selectedAgent?.editableInstructions ??
                  ""
                }
                onChange={handleInstructionsChange}
                placeholder="System prompt for the agent..."
                className="font-mono text-sm h-24"
                rows={3}
              />
              {selectedAgent?.hasStructuredInstructions && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This is an editable text projection of structured agent
                  instructions. Editing it replaces the structured value for
                  this request.
                </p>
              )}
            </div>
            <Button
              className={`ml-2 mb-1 absolute right-0 ${isInstructionOverrideDirty ? "visible" : "invisible"}`}
              variant="secondary"
              onClick={handleResetInstructions}
              disabled={!isInstructionOverrideDirty}
              title="Reset to agent's default prompt"
            >
              Reset
            </Button>
          </div>
        </CollapsibleSection>
      </div>
      <div className="px-4 bg-muted/30 rounded-lg">
        <CollapsibleSection title="Context & Storage Options">
          <div className="flex flex-row gap-4">
            <div className="w-1/2">
              <label className="block text-sm font-medium mb-1">
                Context Options
              </label>
              <JsonEditor
                defaultValue={contextOptions}
                onChange={setContextOptions}
                validator={vContextOptions}
              />
            </div>
            <div className="w-1/2">
              <label className="block text-sm font-medium mb-1">
                Storage Options
              </label>
              <JsonEditor
                defaultValue={storageOptions}
                onChange={setStorageOptions}
                validator={vStorageOptions}
              />
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </>
  );
};

export default MessageComposer;
