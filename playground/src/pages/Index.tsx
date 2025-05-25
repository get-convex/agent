import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Copy } from "lucide-react";
import {
  ChatBubbleIcon,
  MagnifyingGlassIcon,
  LightningBoltIcon,
} from "@radix-ui/react-icons";

const Index = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard!",
      duration: 2000,
    });
  };

  return (
    <div
      className="min-h-screen antialiased"
      style={{ backgroundColor: "#F9F7EE" }}
    >
      {/* Header */}
      <header style={{ backgroundColor: "#F9F7EE" }}>
        <div className="container mx-auto px-2 py-4">
          <div className="flex items-center justify-between">
            {/* Left logo */}
            <div className="flex items-center">
              <img
                src={import.meta.env.BASE_URL + "convexlogo.png"}
                alt="Convex"
                className="h-4 w-auto"
              />
            </div>

            {/* Right nav */}
            <div className="flex items-center">
              <nav className="hidden md:flex">
                <a
                  href="https://docs.convex.dev"
                  className="text-gray-600 hover:text-gray-900"
                >
                  Docs
                </a>
              </nav>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="container mx-auto px-4 py-2">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-6 text-gray-900">
            Agent Playground
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            A powerful playground for experimenting with{" "}
            <a
              href="https://convex.dev/components/agent"
              className="text-orange-500 hover:text-orange-600 font-medium"
            >
              @convex-dev/agent
            </a>
            . Test your agents, browse threads, and explore message interactions
            in real-time.
          </p>
          <Button
            size="lg"
            className="mt-10 text-lg px-10 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-full"
            onClick={() => navigate("/play")}
          >
            Launch Playground
          </Button>
        </div>

        {/* Features Grid */}
        <div className="flex flex-col items-center mb-10">
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl">
            <div
              className="bg-white rounded-lg p-6 border text-left"
              style={{ borderColor: "#E5E7EB" }}
            >
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center mr-4 shadow-sm">
                  <ChatBubbleIcon className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">
                  Thread Management
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed">
                Browse and manage user threads with ease
              </p>
            </div>
            <div
              className="bg-white rounded-lg p-6 border text-left"
              style={{ borderColor: "#E5E7EB" }}
            >
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center mr-4 shadow-sm">
                  <MagnifyingGlassIcon className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">
                  Message Analysis
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed">
                View detailed message metadata and tool call information
              </p>
            </div>
            <div
              className="bg-white rounded-lg p-6 border text-left"
              style={{ borderColor: "#E5E7EB" }}
            >
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-yellow-500 rounded-lg flex items-center justify-center mr-4 shadow-sm">
                  <LightningBoltIcon className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">
                  Context Experimentation
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed">
                Test different context options and message interactions
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Screenshot */}
      <div
        className="w-full bg-white border-t border-b mb-20"
        style={{ borderColor: "#E5E7EB" }}
      >
        <div className="max-w-6xl mx-auto py-8">
          <img
            src={import.meta.env.BASE_URL + "screenshot.png"}
            alt="Agent Playground"
            className="w-full h-auto rounded-xl"
          />
        </div>
      </div>

      {/* Installation Instructions */}
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold mb-4 text-gray-900">
              Getting Started
            </h2>
            <p className="text-lg text-gray-600">
              Set up your agent playground in minutes with these simple steps
            </p>
          </div>

          <div className="space-y-10">
            <div>
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm font-semibold mr-4">
                  1
                </div>
                <h3 className="text-xl font-semibold text-gray-900">
                  Install the Package
                </h3>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                    </div>
                    <div className="text-sm text-gray-500">Terminal</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-gray-200"
                      onClick={() =>
                        copyToClipboard("npm i @convex-dev/agent-playground")
                      }
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-4">
                  <pre className="text-sm text-gray-800">
                    <code>npm i @convex-dev/agent-playground</code>
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm font-semibold mr-4">
                  2
                </div>
                <h3 className="text-xl font-semibold text-gray-900">
                  Set Up Your Playground API
                </h3>
              </div>
              <p className="text-gray-600 mb-4">
                Create a new file{" "}
                <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                  convex/playground.ts
                </code>{" "}
                with:
              </p>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                    </div>
                    <div className="text-sm text-gray-500">
                      convex/playground.ts
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-gray-200"
                      onClick={() =>
                        copyToClipboard(`import { definePlaygroundAPI } from "@convex-dev/agent-playground";
import { components } from "./_generated/api";
import { weatherAgent, fashionAgent } from "./example";

export const {
  isApiKeyValid,
  listAgents,
  listUsers,
  listThreads,
  listMessages,
  createThread,
  generateText,
  fetchPromptContext,
} = definePlaygroundAPI(components.agent, {
  agents: [weatherAgent, fashionAgent],
});`)
                      }
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-4 overflow-x-auto">
                  <pre className="text-sm text-gray-800">
                    <code>{`import { definePlaygroundAPI } from "@convex-dev/agent-playground";
import { components } from "./_generated/api";
import { weatherAgent, fashionAgent } from "./example";

export const {
  isApiKeyValid,
  listAgents,
  listUsers,
  listThreads,
  listMessages,
  createThread,
  generateText,
  fetchPromptContext,
} = definePlaygroundAPI(components.agent, {
  agents: [weatherAgent, fashionAgent],
});`}</code>
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm font-semibold mr-4">
                  3
                </div>
                <h3 className="text-xl font-semibold text-gray-900">
                  Generate an API Key
                </h3>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                    </div>
                    <div className="text-sm text-gray-500">Terminal</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-gray-200"
                      onClick={() =>
                        copyToClipboard(
                          `npx convex run --component agent apiKeys:issue '{name: "my key"}'`
                        )
                      }
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-4">
                  <pre className="text-sm text-gray-800">
                    <code>
                      npx convex run --component agent apiKeys:issue '
                      {`{name: "my key"}`}'
                    </code>
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm font-semibold mr-4">
                  4
                </div>
                <h3 className="text-xl font-normal text-gray-900">
                  Launch the Playground
                </h3>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                      <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                    </div>
                    <div className="text-sm text-gray-500">Terminal</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-gray-200"
                      onClick={() =>
                        copyToClipboard("npx @convex-dev/agent-playground")
                      }
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-4">
                  <pre className="text-sm text-gray-800">
                    <code>npx @convex-dev/agent-playground</code>
                  </pre>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-16 text-center">
            <Button
              size="lg"
              className="text-lg px-10 py-4 bg-gray-900 hover:bg-gray-800 text-white rounded-full"
              onClick={() => navigate("/play")}
            >
              Try the Playground Now
            </Button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-black mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="text-white text-sm">
              Built with{" "}
              <a
                href="https://convex.dev"
                className="text-white hover:text-orange-500 font-medium"
              >
                Convex
              </a>{" "}
              for the developer community
            </div>
            <div className="flex items-center space-x-6 mt-4 md:mt-0">
              <a
                href="https://docs.convex.dev"
                className="text-white hover:text-gray-300 text-sm"
              >
                Documentation
              </a>
              <a
                href="https://github.com/get-convex/agent"
                className="text-white hover:text-gray-300 text-sm"
              >
                GitHub
              </a>
              <a
                href="https://convex.dev/components/agent"
                className="text-white hover:text-gray-300 text-sm"
              >
                Components
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
