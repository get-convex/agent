import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Copy } from "lucide-react";
import {
  ChatBubbleIcon,
  MagnifyingGlassIcon,
  LightningBoltIcon,
} from "@radix-ui/react-icons";

const playgroundCode = `import { definePlaygroundAPI } from "@convex-dev/agent";
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
});`;

const issueApiKey = `npx convex run --component agent apiKeys:issue`;

const runPlayground = `npx @convex-dev/agent-playground`;

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
                className="h-3.5 w-auto"
              />
            </div>

            {/* Right nav */}
            <div className="flex items-center">
              <nav className="hidden md:flex">
                <a
                  href="https://github.com/get-convex/agent#installation"
                  className="neutral-800 hover:text-gray-900"
                >
                  Readme
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
          <p className="text-lg text-gray-600 max-w-3xl mx-auto leading-relaxed">
            A powerful playground for experimenting with{" "}
            <a
              href="https://convex.dev/components/agent"
              className="text-violet-900 hover:text-violet-950 font-normal  hover:underline"
            >
              @convex-dev/agent
            </a>
            . Test your agents, browse threads, and explore message interactions
            in real-time.
          </p>
          <Button
            size="lg"
            className="mt-10 text-base px-10 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-full shadow-xs focus:ring-1 focus:ring-[#B02A5B] hover:shadow-[0_0_20px_rgba(176,42,91,0.3)] border-2 border-[#B02A5B]"
            onClick={() => navigate("/play")}
          >
            Launch Playground
          </Button>
        </div>

        {/* Features Grid */}
        <div className="flex flex-col items-center mb-10">
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl">
            <div
              className="bg-white rounded-lg p-4 border text-left"
              style={{ borderColor: "#E5E7EB" }}
            >
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center mr-4 shadow-xs">
                  <ChatBubbleIcon className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-lg features-title text-gray-900">
                  Thread Management
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed">
                Browse and manage user threads with ease
              </p>
            </div>
            <div
              className="bg-white rounded-lg p-4 border text-left"
              style={{ borderColor: "#E5E7EB" }}
            >
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center mr-4 shadow-xs">
                  <MagnifyingGlassIcon className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-lg features-title text-gray-900">
                  Message Analysis
                </h3>
              </div>
              <p className="text-gray-600 leading-relaxed">
                View detailed message metadata and tool call information
              </p>
            </div>
            <div
              className="bg-white rounded-lg p-4 border text-left"
              style={{ borderColor: "#E5E7EB" }}
            >
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-yellow-500 rounded-lg flex items-center justify-center mr-4 shadow-xs">
                  <LightningBoltIcon className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-lg features-title text-gray-900">
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
              Set up your agent playground in minutes with these simple steps.
              If you don't yet have a Convex project with the Agent component,
              check out the{" "}
              <a
                href="https://docs.convex.dev/agents"
                className="text-violet-900 hover:text-violet-950 font-normal  hover:underline"
              >
                Agent docs
              </a>
            </p>
          </div>

          <div className="space-y-10">
            <div>
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm font-semibold mr-4">
                  1
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
                      onClick={() => copyToClipboard(playgroundCode)}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-4 overflow-x-auto">
                  <pre className="text-sm text-gray-800">
                    <code>{playgroundCode}</code>
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
                      onClick={() => copyToClipboard(issueApiKey)}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-4">
                  <pre className="text-sm text-gray-800">
                    <code>{issueApiKey}</code>
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center mb-4">
                <div className="w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm font-semibold mr-4">
                  3
                </div>
                <h3 className="text-xl font-normal text-gray-900">
                  Use the Hosted Playground (Or run it locally)
                </h3>
              </div>
              <p className="text-gray-600 mb-4">
                You can use this hosted playground to access your own data. Or
                run it locally from the CLI via:
              </p>
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
                      onClick={() => copyToClipboard(runPlayground)}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-4">
                  <pre className="text-sm text-gray-800">
                    <code>{runPlayground}</code>
                  </pre>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-16 text-center">
            <Button
              size="lg"
              className="text-base px-10 py-4 bg-gray-800 hover:bg-gray-900 text-white rounded-full shadow-xs focus:ring-1 focus:ring-[#B02A5B] hover:shadow-[0_0_20px_rgba(176,42,91,0.3)] border-2 border-[#B02A5B]"
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
              <a
                href="https://convex.dev"
                className="text-white hover:text-orange-500 font-medium"
              >
                Convex
              </a>{" "}
              Agent Playground
            </div>
            <div className="flex items-center space-x-6 mt-4 md:mt-0">
              <a
                href="https://github.com/get-convex/agent#installation"
                className="text-white hover:text-gray-300 text-sm"
              >
                Readme
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
