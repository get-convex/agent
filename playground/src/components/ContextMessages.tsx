import React from "react";
import { ContextMessage } from "../types";

interface ContextMessagesProps {
  messages: ContextMessage[];
}

const ContextMessages: React.FC<ContextMessagesProps> = ({ messages }) => {
  return (
    <div className="mt-4">
      <h3 className="font-medium mb-2">Context Messages</h3>

      {messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No context messages available.
        </p>
      ) : (
        <div className="border rounded-md">
          {/* Column Headers */}
          <div className="p-3 flex items-start gap-3 border-b bg-muted/50">
            <div className="grow text-center self-end">Message Text</div>

            {/* TODO: Fetch the text and vector search ranks and show them
            <div className="shrink-0 w-24 text-right">
              <span className="text-xs font-medium">Text/Vector </span>
              <br />
              <span className="text-xs font-medium">Search Rank</span>
            </div> */}
          </div>

          {/* Message rows */}
          {messages.map((message, index) => (
            <div
              key={index + message._id}
              className={`p-3 flex items-center gap-3 ${
                index < messages.length - 1 ? "border-b" : ""
              }`}
            >
              {message.text ? (
                <div className="grow">{message.text}</div>
              ) : (
                <div className="grow max-w-full overflow-x-auto">
                  <span className="text-xs font-medium">
                    {message.message?.role}
                  </span>
                  <br />
                  <pre className="text-xs bg-muted overflow-x-auto p-2 rounded-md">
                    {JSON.stringify(message.message?.content, null, 2)}
                  </pre>
                </div>
              )}

              {message.textSearchRank !== undefined ||
                (message.vectorSearchRank !== undefined && (
                  <div className="shrink-0 w-6 text-center">
                    <div className="flex flex-col">
                      {message.textSearchRank !== undefined && (
                        <span className="search-rank text-rank">
                          T:{message.textSearchRank}
                        </span>
                      )}
                      {message.vectorSearchRank !== undefined && (
                        <span className="search-rank vector-rank">
                          V:{message.vectorSearchRank}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContextMessages;
