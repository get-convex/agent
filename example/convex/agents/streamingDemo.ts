// Agent for the full streaming demo with tool approval support.
// Combines streaming patterns with approval-gated tools.
import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { defaultConfig } from "./config";
import { z } from "zod/v4";

// Tool that always requires approval
const deleteFileTool = createTool({
  description: "Delete a file from the system",
  inputSchema: z.object({
    filename: z.string().describe("The name of the file to delete"),
  }),
  needsApproval: () => true,
  execute: async (_ctx, input) => {
    return `Successfully deleted file: ${input.filename}`;
  },
});

// Tool with conditional approval (requires approval for amounts > $100)
const transferMoneyTool = createTool({
  description: "Transfer money to an account",
  inputSchema: z.object({
    amount: z.number().describe("The amount to transfer"),
    toAccount: z.string().describe("The destination account"),
  }),
  needsApproval: async (_ctx, input) => {
    return input.amount > 100;
  },
  execute: async (_ctx, input) => {
    return `Transferred $${input.amount} to account ${input.toAccount}`;
  },
});

// Tool that doesn't need approval
const checkBalanceTool = createTool({
  description: "Check the account balance",
  inputSchema: z.object({
    accountId: z.string().describe("The account to check"),
  }),
  execute: async (_ctx, _input) => {
    return `Balance: $1,234.56`;
  },
});

export const streamingDemoAgent = new Agent(components.agent, {
  name: "Streaming Demo Agent",
  instructions:
    "You are a concise assistant who responds with emojis " +
    "and abbreviations like lmao, lol, iirc, afaik, etc. where appropriate. " +
    "You can delete files, transfer money, and check account balances. " +
    "Always confirm what action you took after it completes.",
  tools: {
    deleteFile: deleteFileTool,
    transferMoney: transferMoneyTool,
    checkBalance: checkBalanceTool,
  },
  stopWhen: stepCountIs(5),
  ...defaultConfig,
  callSettings: { temperature: 0 },
});
