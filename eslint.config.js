import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    ignores: [
      "dist/**",
      "eslint.config.js",
      "vitest.config.ts",
      "**/_generated/",
      "node10stubs.mjs",
    ],
  },
  {
    files: ["src/**/*.{js,mjs,cjs,ts,tsx}", "example/**/*.{js,mjs,cjs,ts,tsx}", "playground/**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          "./tsconfig.json",
          "./example/tsconfig.json",
          "./example/convex/tsconfig.json",
          "./playground/tsconfig.json",
          "./playground/convex/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  // Convex code - Worker environment
  {
    files: ["src/**/*.{ts,tsx}", "example/convex/**/*.{ts,tsx}", "playground/convex/**/*.{ts,tsx}"],
    ignores: ["src/react/**"],
    languageOptions: {
      globals: globals.worker,
    },
    rules: {
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
    files: ["src/react/**/*.{ts,tsx}", "example/src/**/*.{ts,tsx}", "playground/src/**/*.{ts,tsx}"],
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
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
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
  // Example config files (vite.config.ts, etc.) - Node environment
  {
    files: ["example/vite.config.ts", "example/**/*.config.{js,ts}", "playground/vite.config.ts", "playground/**/*.config.{js,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
];
