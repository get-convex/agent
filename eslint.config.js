import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import convexPlugin from "@convex-dev/eslint-plugin";

const providerAdapterImportPatterns = [
  {
    group: [
      "ai",
      "ai/*",
      "@ai-sdk/*",
      "./vercel",
      "./vercel/**",
      "../vercel",
      "../vercel/**",
      "**/vercel",
      "**/vercel/**",
    ],
    message:
      "Provider SDK and Vercel adapter imports belong in the src/vercel adapter boundary.",
  },
];

const providerAdapterDynamicImportRestrictions = [
  {
    selector: 'ImportExpression[source.value="ai"]',
    message:
      "Provider SDK dynamic imports belong in the src/vercel adapter boundary.",
  },
  {
    selector: "ImportExpression[source.value=/^ai\\x2f/]",
    message:
      "Provider SDK dynamic imports belong in the src/vercel adapter boundary.",
  },
  {
    selector: "ImportExpression[source.value=/^@ai-sdk\\x2f/]",
    message:
      "Provider SDK dynamic imports belong in the src/vercel adapter boundary.",
  },
  {
    selector: 'ImportExpression[source.value="vercel"]',
    message:
      "Vercel adapter dynamic imports belong in the src/vercel adapter boundary.",
  },
  {
    selector: "ImportExpression[source.value=/^vercel\\x2f/]",
    message:
      "Vercel adapter dynamic imports belong in the src/vercel adapter boundary.",
  },
  {
    selector: "ImportExpression[source.value=/\\x2fvercel$/]",
    message:
      "Vercel adapter dynamic imports belong in the src/vercel adapter boundary.",
  },
  {
    selector: "ImportExpression[source.value=/\\x2fvercel\\x2f/]",
    message:
      "Vercel adapter dynamic imports belong in the src/vercel adapter boundary.",
  },
];

// The React package entrypoint deliberately exposes these Vercel-backed APIs.
// Keep both the bridge file and its imports explicit: the exception must not
// make that file a general escape hatch into the adapter.
const reactProviderBridge = "src/react/index.ts";
const reactProviderBridgeImports = [
  "../vercel/UIMessages.js",
  "../vercel/react/optimisticallySendMessage.js",
  "../vercel/react/useThreadMessages.js",
  "../vercel/react/useUIMessages.js",
  "../vercel/react/useStreamingUIMessages.js",
];
const escapedReactProviderBridgeImports = reactProviderBridgeImports
  .map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const unapprovedReactProviderImportPattern = [
  "^(?:",
  "ai(?:/.*)?",
  "|@ai-sdk/.*",
  `|(?!(?:${escapedReactProviderBridgeImports})$).*\\/vercel(?:\\/.*)?`,
  ")$",
].join("");

export default [
  {
    ignores: [
      "dist/**",
      "example/dist/**",
      "playground/dist/**",
      "*.config.js",
      "setup.cjs",
      "example/**/*.config.{cjs,js,ts}",
      "playground/**/*.config.{js,ts}",
      "playground/bin/agent-playground.cjs",
      "**/_generated/",
    ],
  },
  {
    files: [
      "src/**/*.{js,mjs,cjs,ts,tsx}",
      "example/**/*.{js,mjs,cjs,ts,tsx}",
      "playground/**/*.{js,mjs,cjs,ts,tsx}",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          "./tsconfig.json",
          "./example/tsconfig.json",
          "./example/convex/tsconfig.json",
          "./playground/tsconfig.app.json",
          "./playground/tsconfig.node.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  // Convex code - Worker environment
  {
    files: [
      "src/**/*.{ts,tsx}",
      "example/convex/**/*.{ts,tsx}",
      "playground/convex/**/*.{ts,tsx}",
    ],
    ignores: ["src/react/**", "src/vercel/react/**"],
    languageOptions: {
      globals: globals.worker,
    },
    plugins: {
      "@convex-dev": convexPlugin,
    },
    rules: {
      ...convexPlugin.configs.recommended[0].rules,

      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
    },
  },
  // React app code - Browser environment
  {
    files: [
      "src/react/**/*.{ts,tsx}",
      "src/vercel/react/**/*.{ts,tsx}",
      "example/ui/**/*.{ts,tsx}",
      "playground/src/**/*.{ts,tsx}",
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: [
      "src/*.{ts,tsx}",
      "src/client/**/*.{ts,tsx}",
      "src/streaming/**/*.{ts,tsx}",
      "src/component/**/*.{ts,tsx}",
      "src/react/**/*.{ts,tsx}",
    ],
    ignores: ["src/**/*.test.{ts,tsx}", "src/vercel/**", reactProviderBridge],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: providerAdapterImportPatterns },
      ],
      "no-restricted-syntax": [
        "error",
        ...providerAdapterDynamicImportRestrictions,
      ],
    },
  },
  {
    files: [reactProviderBridge],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: unapprovedReactProviderImportPattern,
              message:
                "Only the documented Vercel-backed React exports may cross this public package boundary.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...providerAdapterDynamicImportRestrictions,
      ],
    },
  },
  {
    files: ["src/streaming/**/*.{ts,tsx}", "src/component/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "ai",
                "ai/*",
                "@ai-sdk/*",
                "**/vercel/**",
                "**/client/**",
                "**/mapping.js",
                "**/UIMessages.js",
                "**/deltas.js",
              ],
              message:
                "Agent core and component code cannot depend on provider adapters or their compatibility forwarders.",
            },
          ],
        },
      ],
    },
  },
];
