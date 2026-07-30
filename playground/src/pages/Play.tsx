import { useState, useCallback, useEffect } from "react";
import LeftPanel from "@/components/LeftPanel";
import MiddlePanel from "@/components/MiddlePanel";
import RightPanel from "@/components/RightPanel";
import { useToast } from "@/components/ui/use-toast";
import { Switch } from "@/components/ui/switch";
import { useQuery, useAction } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import {
  extractText,
  type MessageDoc,
  type PlaygroundAPI,
} from "@convex-dev/agent";
import { ContextMessage, Thread, Agent } from "@/types";
import { ContextOptions, StorageOptions } from "@convex-dev/agent";
import { useThreadMessages } from "@convex-dev/agent/react";

interface PlayProps {
  apiKey: string;
  api: PlaygroundAPI;
}

// TODO: store preferences in local storage
const DEFAULT_CONTEXT_OPTIONS = {
  recentMessages: 10,
  excludeToolMessages: false,
  searchOtherThreads: false,
  searchOptions: {
    limit: 0,
    textSearch: true,
    vectorSearch: true,
    messageRange: { before: 2, after: 1 },
  },
} as const satisfies ContextOptions;

const DEFAULT_STORAGE_OPTIONS = {
  saveMessages: "promptAndOutput",
} as const satisfies StorageOptions;

function Play({ apiKey, api }: PlayProps) {
  const { toast } = useToast();
  const [stream, setStream] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();
  const [selectedThreadId, setSelectedThreadId] = useState<
    string | undefined
  >();
  const [selectedMessageId, setSelectedMessageId] = useState<
    string | undefined
  >();
  const [selectedAgent, setSelectedAgent] = useState<Agent | undefined>();
  const [contextMessages, setContextMessages] = useState<
    ContextMessage[] | null
  >(null);
  const [storageOptions, setStorageOptions] = useState<StorageOptions>(
    DEFAULT_STORAGE_OPTIONS,
  );
  const [contextOptions, setContextOptions] = useState<ContextOptions>(
    DEFAULT_CONTEXT_OPTIONS,
  );

  // Convex hooks
  const users = usePaginatedQuery(
    api.listUsers,
    { apiKey },
    { initialNumItems: 20 },
  );

  const threads = usePaginatedQuery(
    api.listThreads,
    { apiKey, userId: selectedUserId },
    { initialNumItems: 20 },
  );
  useEffect(() => {
    if (threads.results.length > 0 && !selectedThreadId) {
      setSelectedThreadId(threads.results[0]._id);
    }
  }, [threads.results, selectedThreadId]);

  const messages = useThreadMessages(
    api.listMessages,
    selectedThreadId ? { apiKey, threadId: selectedThreadId } : "skip",
    { initialNumItems: 20, stream },
  );
  useEffect(() => {
    if (messages.results.length > 0 && !selectedMessageId) {
      setSelectedMessageId(messages.results[0].id);
    }
  }, [messages.results, selectedMessageId]);

  const agents = useQuery(api.listAgents, {
    apiKey,
    threadId: selectedThreadId,
    userId: selectedUserId,
  });
  useEffect(() => {
    if (agents && agents.length > 0 && !selectedAgent) {
      setSelectedAgent(agents[0]);
      if (agents[0].contextOptions) {
        setContextOptions(agents[0].contextOptions);
      }
      if (agents[0].storageOptions) {
        setStorageOptions(agents[0].storageOptions);
      }
    } else if (agents && selectedAgent) {
      const newAgent = agents.find(
        (agent) => agent.name === selectedAgent.name,
      );
      if (newAgent) {
        if (JSON.stringify(selectedAgent) !== JSON.stringify(newAgent)) {
          setSelectedAgent(newAgent);
        }
      } else {
        // The selected agent is no longer in the list of agents, so clear it
        setSelectedAgent(undefined);
      }
    }
  }, [agents, selectedAgent]);

  // Convex actions
  const generateText = useAction(api.generateText);
  const fetchPromptContext = useAction(api.fetchPromptContext);

  // Selected thread and message
  const selectedThread = threads.results.find(
    (thread) => thread._id === selectedThreadId,
  );
  const selectedMessage = messages.results.find(
    (message) => message._id === selectedMessageId,
  );

  // Handlers
  const handleSelectUserId = (userId: string | undefined) => {
    setSelectedUserId(userId);
    setSelectedThreadId(undefined);
    setSelectedMessageId(undefined);
  };

  const handleSelectThread = (thread: Thread) => {
    setSelectedThreadId(thread._id);
    setSelectedMessageId(undefined);
  };

  const handleSelectMessage = (messageId: string) => {
    setSelectedMessageId(messageId);
    const message = messages.results.find((m) => m._id === messageId);
    if (
      message &&
      message.agentName &&
      selectedAgent?.name !== message.agentName
    ) {
      const agent = agents?.find((a) => a.name === message.agentName);
      if (agent) {
        setSelectedAgent(agent);
      }
    }
  };

  // Fetch context messages
  const fetchContextMessages = useCallback(
    async (contextOptions: ContextOptions) => {
      if (!selectedMessage || !selectedAgent) {
        toast({ title: "Select a message and agent first" });
        return;
      }
      try {
        const context = await fetchPromptContext({
          apiKey,
          agentName: selectedAgent.name,
          threadId: selectedThreadId,
          userId: selectedUserId,
          searchText:
            selectedMessage.message && extractText(selectedMessage.message),
          targetMessageId: selectedMessage._id,
          contextOptions,
        });
        setContextMessages(context);
      } catch (err) {
        toast({ title: "Failed to fetch context", description: String(err) });
      }
    },
    [
      apiKey,
      fetchPromptContext,
      selectedMessage,
      selectedAgent,
      selectedThreadId,
      selectedUserId,
      toast,
    ],
  );

  // Send message
  const handleSendMessage = async (
    message: string,
    agentName: string,
    context: ContextOptions | undefined,
    storage: StorageOptions | undefined,
    instructions?: string,
  ): Promise<{ text: string; messages: MessageDoc[] } | undefined> => {
    if (!selectedThreadId || !selectedUserId) {
      toast({ title: "Select a thread and user first" });
      return;
    }
    try {
      const { text, messages } = await generateText({
        apiKey,
        agentName,
        threadId: selectedThreadId,
        userId: selectedUserId,
        prompt: message,
        contextOptions: context,
        storageOptions: storage,
        instructions,
      });
      return { text, messages };
      // Optionally, refresh messages or update UI here
    } catch (err) {
      toast({ title: "Failed to send message", description: String(err) });
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-secondary p-3 border-b flex items-center justify-between">
        <h1 className="font-bold text-lg">Playground</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="streaming-toggle" className="text-sm font-medium">
            Streaming
          </label>
          <Switch
            id="streaming-toggle"
            checked={stream}
            onCheckedChange={setStream}
          />
        </div>
      </div>
      <div className="flex-grow flex overflow-hidden">
        <div className="w-1/5 h-full">
          <LeftPanel
            users={users.results}
            threads={threads.results}
            selectedUserId={selectedUserId}
            selectedThreadId={selectedThreadId}
            onSelectUserId={handleSelectUserId}
            onSelectThread={handleSelectThread}
            onLoadMoreThreads={threads.loadMore}
            canLoadMoreThreads={threads.status === "CanLoadMore"}
          />
        </div>
        <div className="w-2/5 h-full border-x">
          <MiddlePanel
            agents={agents}
            selectedAgent={selectedAgent}
            setSelectedAgent={setSelectedAgent}
            users={users.results}
            messages={messages.results}
            selectedMessageId={selectedMessageId}
            onSelectMessage={handleSelectMessage}
            contextOptions={contextOptions}
            setContextOptions={setContextOptions}
            storageOptions={storageOptions}
            setStorageOptions={setStorageOptions}
            selectedThreadTitle={selectedThread?.title}
            onSendMessage={handleSendMessage}
          />
        </div>
        <div className="w-2/5 h-full">
          <RightPanel
            selectedMessage={selectedMessage ?? null}
            contextMessages={contextMessages}
            contextOptions={contextOptions}
            setContextOptions={setContextOptions}
            fetchContextMessages={fetchContextMessages}
          />
        </div>
      </div>
    </div>
  );
}

export default Play;
