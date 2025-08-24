#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");
const dotenv = require("dotenv");

// Load .env.local file
dotenv.config({ path: ".env.local" });
// Also load regular .env as fallback
dotenv.config();

// Path to the playground directory (relative to this script)
const playgroundDir = path.join(__dirname, "..");

// Forward any additional CLI arguments
const args = process.argv.slice(2);

// Check for Convex URL in environment variables
const convexUrl =
  process.env.VITE_CONVEX_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  process.env.CONVEX_URL;
console.log("Detected Convex URL:", convexUrl);

// If we have a Convex URL, encode it and add to args
if (convexUrl) {
  const encodedUrl = encodeURIComponent(convexUrl);
  args.unshift("--open", `/play/${encodedUrl}`);
}

// Pick correct npx binary for OS
const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

// Use npx to run vite directly
const child = spawn(npxBin, ["vite", "preview", ...args], {
  cwd: playgroundDir,
  stdio: "inherit",
  env: process.env, 
  shell: process.platform === "win32", // ✅ needed for Windows
});

child.on("exit", (code) => process.exit(code));
