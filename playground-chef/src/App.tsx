import { useCallback, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import Editor from "@monaco-editor/react";
import { Button } from "./components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import {
  extractText,
  type ContextOptions,
  type MessageDoc,
  type StorageOptions,
} from "@convex-dev/agent";
import type { PlaygroundAPI } from "@convex-dev/agent/playground";
import { anyApi } from "convex/server";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import { assert } from "convex-helpers";
import { toast } from "sonner";
import { CoreMessage } from "ai";
dayjs.extend(relativeTime);

const DEFAULT_CONTEXT_OPTIONS: ContextOptions = {
  recentMessages: 10,
  includeToolCalls: false,
  searchOtherThreads: false,
  searchOptions: {
    limit: 10,
    textSearch: true,
    vectorSearch: true,
    messageRange: { before: 0, after: 0 },
  },
};

const DEFAULT_STORAGE_OPTIONS: StorageOptions = {
  saveAllInputMessages: false,
  saveAnyInputMessages: true,
  saveOutputMessages: true,
};

if (!import.meta.env.VITE_PLAYGROUND_API_PATH) {
  throw new Error("VITE_PLAYGROUND_API_PATH is not set");
}
const api = (import.meta.env.VITE_PLAYGROUND_API_PATH as string)
  .trim()
  .split("/")
  .reduce((acc, part) => {
    return acc[part];
  }, anyApi) as unknown as PlaygroundAPI;

const apiKey = import.meta.env.VITE_PLAYGROUND_API_KEY!;
assert(apiKey, "VITE_PLAYGROUND_API_KEY is not set");

export default function App() {
  const [selectedUser, setSelectedUser] = useState<string>();
  const [selectedThread, setSelectedThread] = useState<string>();
  const [selectedAgent, setSelectedAgent] = useState<string>();
  // const [selectedTool, setSelectedTool] = useState<string>();
  const [selectedMessage, setSelectedMessage] = useState<MessageDoc>();
  const [newMessage, setNewMessage] = useState("");
  const [contextOptions, setContextOptions] = useState(
    JSON.stringify(DEFAULT_CONTEXT_OPTIONS, null, 2)
  );
  const [storageOptions, setStorageOptions] = useState(
    JSON.stringify(DEFAULT_STORAGE_OPTIONS, null, 2)
  );
  const [contextMessages, setContextMessages] = useState<CoreMessage[]>([]);
  const users = usePaginatedQuery(
    api.listUsers,
    { apiKey },
    { initialNumItems: 20 }
  );
  if (users.results.length > 0 && !selectedUser) {
    setSelectedUser(users.results[0].id);
  }

  const threads = usePaginatedQuery(
    api.listThreads,
    selectedUser ? { apiKey, userId: selectedUser } : "skip",
    { initialNumItems: 20 }
  );
  if (threads.results.length > 0 && !selectedThread) {
    setSelectedThread(threads.results[0]._id);
  }

  const messages = usePaginatedQuery(
    api.listMessages,
    selectedThread ? { apiKey, threadId: selectedThread } : "skip",
    { initialNumItems: 20 }
  );
  if (messages.results.length > 0 && !selectedMessage) {
    setSelectedMessage(messages.results[0]);
  }

  const agents = useQuery(api.listAgents, { apiKey });

  const fetchContext = useAction(api.fetchPromptContext);

  const fetchContextMessages = useCallback(async () => {
    if (!selectedMessage) {
      toast.error("No message selected");
      return;
    }
    if (!selectedAgent) {
      toast.error("No agent selected");
      return;
    }
    const context = await fetchContext({
      apiKey,
      agentName: selectedAgent,
      threadId: selectedThread,
      userId: selectedUser,
      messages: [selectedMessage.message!],
      contextOptions: JSON.parse(contextOptions),
      beforeMessageId: selectedMessage?._id,
    });
    setContextMessages(context);
  }, [
    fetchContext,
    messages.results,
    selectedMessage?._id,
    selectedThread,
    contextOptions,
  ]);

  return (
    <div className="min-h-screen flex">
      {/* Left Panel */}
      <div className="w-80 border-r p-4 flex flex-col bg-white">
        <Select value={selectedUser} onValueChange={setSelectedUser}>
          <SelectTrigger className="bg-white">
            <SelectValue placeholder="Select a user" />
          </SelectTrigger>
          <SelectContent>
            {users.results.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="mt-4 flex-1 overflow-auto">
          {threads.results.map((thread) => (
            <div
              key={thread._id}
              className={`p-3 cursor-pointer hover:bg-gray-50 ${
                selectedThread === thread._id ? "bg-gray-100" : "bg-white"
              }`}
              onClick={() => setSelectedThread(thread._id)}
            >
              <div className="font-medium">{thread.title}</div>
              <div className="text-sm text-gray-600">{thread.summary}</div>
              <div className="text-sm text-gray-400 truncate">
                {thread.latestMessage}
              </div>
              <div className="text-xs text-gray-400 mt-1 flex justify-between">
                <span>Created {dayjs(thread._creationTime).fromNow()}</span>
                <span>
                  Last message{" "}
                  {dayjs(
                    thread.lastMessageAt ?? thread._creationTime
                  ).fromNow()}
                </span>
              </div>
            </div>
          ))}
        </div>

        {threads.status === "CanLoadMore" && (
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              threads.loadMore(10);
            }}
          >
            Load More
          </Button>
        )}
      </div>

      {/* Middle Panel */}
      <div className="flex-1 p-4 border-r overflow-auto bg-gray-50">
        <div className="flex flex-col-reverse space-y-4">
          {messages.results.map((message) => (
            <div
              key={message.id}
              className={`flex flex-col rounded-lg bg-white p-4 shadow-sm cursor-pointer ${
                selectedMessage?.id === message.id ? "ring-2 ring-blue-500" : ""
              }`}
              onClick={() => setSelectedMessage(message)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`${
                      message.message?.role === "user"
                        ? "bg-blue-100 text-blue-800"
                        : message.message?.role === "assistant"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                    } px-2 py-1 rounded-full text-sm`}
                  >
                    {message.message?.role === "user"
                      ? "👤"
                      : message.message?.role === "assistant"
                        ? "🤖" + message.agentName
                        : "⚙️"}{" "}
                  </span>
                  {message.message?.role === "assistant" && message.tool && (
                    <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-sm">
                      🧰 Tool Call
                    </span>
                  )}
                  {message.message?.role === "tool" && (
                    <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-sm">
                      📦 Tool Response
                    </span>
                  )}
                </div>
                <span className="text-sm text-gray-400">
                  {message.usage?.totalTokens}
                </span>
              </div>

              <div className="mt-2">{message.text}</div>

              {message.message &&
                message.message?.role === "assistant" &&
                message.tool &&
                typeof message.message.content !== "string" && (
                  <div className="mt-2 pl-4 border-l-2 border-yellow-200">
                    <div className="text-sm text-gray-600">
                      <div className="font-medium">
                        Tool:{" "}
                        {
                          message.message.content.find(
                            (c) => c.type === "tool-call"
                          )?.toolName
                        }
                      </div>
                      <div className="font-mono bg-gray-50 p-2 mt-1 rounded">
                        {JSON.stringify(
                          message.message.content.find(
                            (c) => c.type === "tool-call"
                          )?.args,
                          null,
                          2
                        )}
                      </div>
                    </div>
                  </div>
                )}

              {message.message &&
                message.message?.role === "tool" &&
                typeof message.message.content !== "string" && (
                  <div className="mt-2 pl-4 border-l-2 border-purple-200">
                    <div className="text-sm text-gray-600">
                      <div className="font-medium">
                        Response from:{" "}
                        {
                          message.message.content.find(
                            (c) => c.type === "tool-result"
                          )?.toolName
                        }
                      </div>
                      <div className="font-mono bg-gray-50 p-2 mt-1 rounded">
                        {JSON.stringify(
                          message.message.content.find(
                            (c) => c.type === "tool-result"
                          )?.result,
                          null,
                          2
                        )}
                      </div>
                    </div>
                  </div>
                )}
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel */}
      <div className="w-96 p-4 flex flex-col gap-4 overflow-auto bg-white">
        {/* Selected Message JSON */}
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Selected Message</h3>
          <div className="h-48">
            <Editor
              height="100%"
              defaultLanguage="json"
              value={JSON.stringify(selectedMessage, null, 2)}
              options={{
                minimap: { enabled: false },
                readOnly: true,
                fontSize: 12,
              }}
            />
          </div>
        </div>

        {/* New Message Section */}
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">New Message</h3>

          <div className="space-y-4">
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {agents?.map((agent) => (
                  <SelectItem key={agent} value={agent}>
                    {agent}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* <Select value={selectedTool} onValueChange={setSelectedTool}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select a tool (optional)" />
              </SelectTrigger>
              <SelectContent>
                {TOOLS.map((tool) => (
                  <SelectItem key={tool.id} value={tool.id}>
                    <div>
                      <div>{tool.name}</div>
                      <div className="text-xs text-gray-500">
                        {tool.description}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select> */}

            <details>
              <summary className="cursor-pointer font-medium">
                Context Options
              </summary>
              <div className="mt-2 h-32">
                <Editor
                  height="100%"
                  defaultLanguage="json"
                  value={contextOptions}
                  onChange={(value) => setContextOptions(value || "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                  }}
                />
              </div>
            </details>

            <details>
              <summary className="cursor-pointer font-medium">
                Storage Options
              </summary>
              <div className="mt-2 h-32">
                <Editor
                  height="100%"
                  defaultLanguage="json"
                  value={storageOptions}
                  onChange={(value) => setStorageOptions(value || "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                  }}
                />
              </div>
            </details>

            <textarea
              className="w-full h-32 p-2 border rounded bg-white"
              placeholder="Enter your message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
            />

            <Button className="w-full">Send Message</Button>
          </div>

          <div className="mt-4 p-2 bg-gray-50 rounded">
            <h4 className="font-medium mb-2">Latest Response</h4>
            <p className="text-sm text-gray-600">No response yet</p>
          </div>
        </div>

        {/* Context Messages */}
        <div className="border rounded-lg p-4">
          <h3 className="font-medium mb-2">Context Messages</h3>
          <div className="space-y-2">
            {contextMessages.map((msg, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <div className="w-20 flex-shrink-0">
                  {/* {msg.vectorSearchRank !== null && (
                    <span className="text-green-600">
                      ✓ ({msg.vectorSearchRank})
                    </span>
                  )} */}
                </div>
                <div className="flex-1">{extractText(msg)}</div>
                <div className="w-20 flex-shrink-0 text-right">
                  {/* {msg.textSearchRank !== null && (
                    <span className="text-blue-600">
                      ✓ ({msg.textSearchRank})
                    </span>
                  )} */}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
