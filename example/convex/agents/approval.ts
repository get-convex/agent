// Tool Approval Demo Agent
// Demonstrates the AI SDK v6 tool approval workflow
import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { defaultConfig } from "./config";
import { z } from "zod/v4";

// A tool that always requires approval before execution
const deleteFileTool = createTool({
  description: "Delete a file from the system. This is a destructive operation.",
  inputSchema: z.object({
    filename: z.string().describe("The name of the file to delete"),
  }),
  needsApproval: (_ctx, input) => {
    console.log("needsApproval called for deleteFile:", input);
    return true;
  },
  execute: async (_ctx, input) => {
    console.log("execute called for deleteFile:", input);
    // Simulated file deletion
    return `Successfully deleted file: ${input.filename}`;
  },
});

// A tool that conditionally requires approval based on the amount
const transferMoneyTool = createTool({
  description: "Transfer money to an account",
  inputSchema: z.object({
    amount: z.number().describe("Amount in dollars to transfer"),
    toAccount: z.string().describe("Target account ID"),
  }),
  // Only require approval for transfers over $100
  needsApproval: async (_ctx, input) => {
    return input.amount > 100;
  },
  execute: async (_ctx, input) => {
    // Simulated money transfer
    return `Transferred $${input.amount} to account ${input.toAccount}`;
  },
});

// A safe tool that never requires approval
const checkBalanceTool = createTool({
  description: "Check the current account balance",
  inputSchema: z.object({
    accountId: z.string().describe("Account ID to check"),
  }),
  execute: async (_ctx, input) => {
    // Simulated balance check
    const balance = Math.floor(Math.random() * 10000);
    return `Account ${input.accountId} has a balance of $${balance}`;
  },
});

// The approval demo agent
export const approvalAgent = new Agent(components.agent, {
  name: "Approval Demo Agent",
  instructions: `You are a helpful assistant that can manage files and money transfers.

You have access to these tools:
- deleteFile: Delete a file (requires user approval)
- transferMoney: Transfer money (requires approval for amounts over $100)
- checkBalance: Check account balance (no approval needed)

IMPORTANT: When you call a tool, STOP immediately after the tool call. Do NOT write any text after the tool call. Do NOT assume the tool will succeed. Wait for the tool result before providing any confirmation or status update to the user.

Use tools when the user asks you to perform an action. For general questions or conversation, just respond normally without calling tools.

This is a demo application - all operations are simulated and safe.`,
  tools: {
    deleteFile: deleteFileTool,
    transferMoney: transferMoneyTool,
    checkBalance: checkBalanceTool,
  },
  stopWhen: stepCountIs(5),
  ...defaultConfig,
  // Override settings to make tool calling more reliable
  callSettings: {
    ...defaultConfig.callSettings,
    temperature: 0,
  },
});
