import { useState, useEffect, ReactNode, useMemo } from "react";
import { useConvex } from "convex/react";
import type { PlaygroundAPI } from "@convex-dev/agent";
import { anyApi } from "convex/server";
import { Button } from "./ui/button";
import { useParams } from "react-router-dom";

const API_KEY_STORAGE_KEY = "playground_api_key";
const API_PATH_STORAGE_KEY = "playground_api_path";
const CLI_COMMAND = `npx convex run --component agent apiKeys:issue '{name:"..."}'`;
const PLAYGROUND_CODE = `
import { definePlaygroundAPI } from "@convex-dev/agent/playground";
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
} = definePlaygroundAPI(components.agent, { agents: [weatherAgent, fashionAgent] });
`;

function getApi(apiPath: string) {
  return apiPath
    .trim()
    .split("/")
    .reduce((acc, part) => acc[part], anyApi) as unknown as PlaygroundAPI;
}

function ApiKeyGate({
  children,
}: {
  children: (apiKey: string, api: PlaygroundAPI) => ReactNode;
}) {
  const { url: encodedUrl } = useParams();
  const deploymentUrl = useMemo(() => {
    if (encodedUrl) {
      try {
        return decodeURIComponent(encodedUrl).replace(/\/$/, "");
      } catch (e) {
        console.error("Error decoding url", encodedUrl, e);
        return null;
      }
    }
    return null;
  }, [encodedUrl]);
  const [apiKey, setApiKey] = useState<string>(() => {
    const storedKey = sessionStorage.getItem(
      `${API_KEY_STORAGE_KEY}-${encodedUrl}`,
    );
    if (storedKey) {
      return storedKey;
    }
    return "";
  });
  const [apiKeyValid, setApiKeyValid] = useState<boolean>(!!apiKey);
  const [apiKeyInput, setApiKeyInput] = useState(apiKey || "");
  const [apiPath, setApiPath] = useState<string>(() => {
    const storedPath = sessionStorage.getItem(
      `${API_PATH_STORAGE_KEY}-${encodedUrl}`,
    );
    if (storedPath) {
      return storedPath;
    }
    return "playground";
  });
  const [apiPathInput, setApiPathInput] = useState(apiPath);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convex = useConvex();
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  // Validate on every keystroke
  useEffect(() => {
    if (!apiPathInput) return;
    const nextApi = getApi(apiPathInput);
    convex
      .query(nextApi.isApiKeyValid, { apiKey: apiKeyInput })
      .then((isValid) => {
        sessionStorage.setItem(
          `${API_PATH_STORAGE_KEY}-${encodedUrl}`,
          apiPathInput,
        );
        setApiPath(apiPathInput);
        if (isValid) {
          setApiKeyValid(true);
          setError(null);
          // Simulate form submission for password managers
        } else {
          setApiKeyValid(false);
          setError("Invalid API key for this playground path.");
        }
        setIsConnected(true);
      })
      .catch(() => {
        if (!convex.connectionState().isWebSocketConnected) {
          setIsConnected(false);
        } else {
          setApiPath("");
        }
        setError(
          "Invalid playground path (could not find isApiKeyValid).\nPlease check the path and try again.\n" +
            "e.g. if you exported the API in convex/foo/playground.ts, it would be foo/playground.\n" +
            "The code there should be:\n" +
            PLAYGROUND_CODE,
        );
      });
  }, [apiKeyInput, apiPathInput, convex, encodedUrl]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (apiKeyValid) {
      sessionStorage.setItem(
        `${API_KEY_STORAGE_KEY}-${encodedUrl}`,
        apiKeyInput,
      );
      setApiKey(apiKeyInput);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(CLI_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (!apiKey || !apiPath || !apiKeyValid) {
    return (
      <div className="fixed inset-0 flex py-8 items-start justify-center bg-black bg-opacity-60 z-50">
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl shadow-2xl p-8 flex flex-col gap-6 w-full max-w-4xl border border-muted min-h-[600px]"
        >
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold mb-1 text-foreground">
              Configure the playground
            </h2>
            <p className="text-sm text-muted-foreground">
              Convex cloud deployment URL:{" "}
              {deploymentUrl ? deploymentUrl : "No deployment URL found"}
            </p>
            {isConnected === false && (
              <div className="text-red-600 text-sm  font-medium mt-2">
                Backend is not connected. Please check your internet connection,
                or the Convex deployment URL in the environment variables /
                sessionStorage.
              </div>
            )}
            <h3 className="text-xl font-bold mb-1 text-foreground">
              API Path {apiPath ? "✅ " : "❌ "}
            </h3>
            <label className="text-sm font-medium text-foreground">
              Playground API Path
            </label>
            <input
              className="border border-input rounded-lg px-4 py-2 text-base font-mono bg-muted focus:outline-none focus:ring-2 focus:ring-blue-500 transition w-full min-w-0"
              type="text"
              autoComplete="username"
              id="agent-playground-api-path"
              value={apiPathInput}
              onChange={(e) =>
                setApiPathInput(
                  e.target.value.trim().replace(/[^a-zA-Z0-9/]/g, ""),
                )
              }
              placeholder="playground"
            />
            <span className="text-xs text-muted-foreground">
              Where you exported the playground api with definePlaygroundAPI.
              Usually <code>playground</code>.
            </span>
          </div>
          <h3 className="text-xl font-bold mb-1 text-foreground">
            API Key {apiKeyValid ? "✅ " : "❌ "}
          </h3>
          <div className="text-muted-foreground text-sm mb-2">
            To use the Playground, you need an API key. After setting up the
            agent in your app, run this command in your project directory (CLI
            or Convex dashboard):
            <div className="relative my-3">
              <pre className="bg-gray-900 text-white rounded-md p-3 pr-14 text-xs overflow-x-auto border border-gray-800 font-mono select-all">
                {CLI_COMMAND}
              </pre>
              <button
                type="button"
                onClick={handleCopy}
                className="absolute top-2 right-2 bg-gray-800 hover:bg-gray-700 text-white rounded px-2 py-1 text-xs flex items-center gap-1 shadow"
                tabIndex={-1}
                aria-label="Copy command"
              >
                {copied ? (
                  <span>Copied!</span>
                ) : (
                  <>
                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                      <rect
                        x="9"
                        y="9"
                        width="13"
                        height="13"
                        rx="2"
                        fill="#fff"
                        fillOpacity="0.1"
                        stroke="#fff"
                        strokeWidth="2"
                      />
                      <rect
                        x="3"
                        y="3"
                        width="13"
                        height="13"
                        rx="2"
                        fill="#fff"
                        fillOpacity="0.2"
                        stroke="#fff"
                        strokeWidth="2"
                      />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
            <span className="block mt-2">
              Paste the resulting API key below.
            </span>
          </div>
          <input
            className="border border-input rounded-lg px-4 py-3 text-base font-mono bg-muted focus:outline-none focus:ring-2 focus:ring-blue-500 transition w-full min-w-0"
            type="password"
            autoComplete="current-password"
            name="api-key"
            id="agent-playground-api-key"
            value={apiKeyInput}
            onChange={(e) =>
              setApiKeyInput(
                e.target.value
                  .trim()
                  .replace(/^['"]|['"]$/g, "")
                  .trim(),
              )
            }
            placeholder="API Key"
            autoFocus
          />
          {error && (
            // we want to show the error in a code block
            <div className="text-red-600 text-sm  font-medium mt-2">
              <pre className="bg-gray-900 text-white rounded-md p-3 pr-14 text-xs overflow-x-auto border border-gray-800 font-mono select-all">
                {error}
              </pre>
            </div>
          )}
          <Button
            type="submit"
            variant="default"
            className="bg-blue-500 text-white rounded-lg px-4 py-2 transition-colors hover:bg-blue-600"
            disabled={!apiPath || !apiKeyValid}
          >
            Submit
          </Button>
        </form>
      </div>
    );
  }

  // Construct the API object using the playground path
  const api: PlaygroundAPI = apiPath
    .trim()
    .split("/")
    .reduce((acc, part) => acc[part], anyApi) as unknown as PlaygroundAPI;
  // Valid
  return children(apiKey, api);
}

export default ApiKeyGate;
