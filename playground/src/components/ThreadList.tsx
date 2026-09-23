import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";
import ThreadItem from "./ThreadItem";
import { Thread } from "../types";

interface ThreadListProps {
  threads: Thread[];
  selectedThreadId: string | undefined;
  onSelectThread: (thread: Thread) => void;
  onLoadMore: () => void;
}

const ThreadList: React.FC<ThreadListProps> = ({
  threads,
  selectedThreadId,
  onSelectThread,
  onLoadMore,
}) => {
  return (
    <div className="flex flex-col h-full">
      <div className="grow overflow-y-auto">
        {threads.map((thread) => (
          <ThreadItem
            key={thread._id}
            thread={thread}
            isSelected={thread._id === selectedThreadId}
            onClick={() => onSelectThread(thread)}
          />
        ))}
      </div>

      <Button
        variant="outline"
        className="m-3 flex items-center justify-center gap-2"
        onClick={onLoadMore}
      >
        <ArrowDown size={16} />
        Load More
      </Button>
    </div>
  );
};

export default ThreadList;
