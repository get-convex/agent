/**
 * Standalone script to verify that the tool approval message sequence
 * is compatible with Gemini. Sends the exact stored message pattern
 * (including consecutive tool messages) to Gemini and checks for errors.
 *
 * Usage:
 *   GOOGLE_GENERATIVE_AI_API_KEY=... npx tsx scripts/test-gemini-approval.ts
 */
import { google } from "@ai-sdk/google";
import { generateText, type ModelMessage } from "ai";

const model = google("gemini-2.0-flash");

// This is the exact message sequence stored in the DB after a tool approval flow.
// The concern is messages 3 and 4: two consecutive "tool" role messages.
const messages: ModelMessage[] = [
  // 1. User prompt
  { role: "user", content: "Delete test.txt" },

  // 2. Assistant responds with tool call + approval request
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "deleteFile",
        input: { filename: "test.txt" },
      },
    ],
  },

  // 3. Tool message: approval response (user approved)
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "deleteFile",
        output: { type: "text", value: "Successfully deleted file: test.txt" },
      },
    ],
  },

  // 4. Assistant final response
  {
    role: "assistant",
    content: [{ type: "text", text: "I deleted test.txt for you." }],
  },

  // 5. New user message (simulating a follow-up that loads the full context)
  { role: "user", content: "What did you just do?" },
];

// Also test the "raw" stored sequence with two consecutive tool messages
const messagesWithConsecutiveTools: ModelMessage[] = [
  { role: "user", content: "Delete test.txt" },
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "deleteFile",
        input: { filename: "test.txt" },
      },
    ],
  },
  // Two consecutive tool messages — this is what's actually stored
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "tc-approval",
        toolName: "deleteFile",
        output: { type: "text", value: "Approved" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "deleteFile",
        output: { type: "text", value: "Successfully deleted file: test.txt" },
      },
    ],
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "I deleted test.txt for you." }],
  },
  { role: "user", content: "What did you just do?" },
];

async function testSequence(label: string, msgs: ModelMessage[]) {
  console.log(`\n=== ${label} ===`);
  console.log(
    "Roles:",
    msgs.map((m) => m.role),
  );
  try {
    const result = await generateText({
      model,
      messages: msgs,
      maxOutputTokens: 100,
    });
    console.log("SUCCESS - Gemini responded:", result.text.slice(0, 200));
  } catch (e: any) {
    console.error("FAILED -", e.message?.slice(0, 500) ?? e);
  }
}

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error(
      "Set GOOGLE_GENERATIVE_AI_API_KEY environment variable first",
    );
    process.exit(1);
  }

  await testSequence("Clean sequence (no consecutive tool msgs)", messages);
  await testSequence(
    "Consecutive tool messages (actual stored format)",
    messagesWithConsecutiveTools,
  );
}

main().catch(console.error);
