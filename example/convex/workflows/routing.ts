// See the docs at https://docs.convex.dev/agents/workflows
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { createThread, saveMessage, stepCountIs } from "@convex-dev/agent";
import { getAuthUserId } from "../utils";
import { agent as simpleAgent } from "../agents/simple";

/**
 * Routing Pattern: Intent-based routing to different code paths
 *
 * This workflow demonstrates having an agent discern user intent and route
 * to different code paths accordingly (e.g., filing a bug, requesting support,
 * or talking to sales).
 */

const workflow = new WorkflowManager(components.workflow);

export const routingWorkflow = workflow.define({
  args: { userMessage: v.string(), threadId: v.string() },
  returns: v.object({
    intent: v.string(),
    response: v.string(),
    metadata: v.any(),
  }),
  handler: async (ctx, args) => {
    console.log("Starting routing workflow for message:", args.userMessage);

    // Step 1: Classify the user's intent
    const intentMsg = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: args.userMessage,
    });

    const classification = await ctx.runAction(
      internal.workflows.routing.classifyIntent,
      {
        promptMessageId: intentMsg.messageId,
        threadId: args.threadId,
      },
      { retry: true },
    );

    console.log("Intent classification:", classification);

    // Step 2: Route to appropriate handler based on intent
    let response: string;
    let metadata: any;

    switch (classification.intent) {
      case "bug_report":
        const bugTicket = await ctx.runMutation(
          internal.workflows.routing.createBugTicket,
          {
            description: args.userMessage,
            severity: classification.confidence > 0.8 ? "high" : "medium",
          },
        );
        response = await ctx.runAction(
          internal.workflows.routing.handleBugReport,
          {
            threadId: args.threadId,
            ticketId: bugTicket.ticketId,
          },
          { retry: true },
        );
        metadata = bugTicket;
        break;

      case "support_request":
        const supportTicket = await ctx.runMutation(
          internal.workflows.routing.createSupportTicket,
          {
            description: args.userMessage,
            priority: classification.confidence > 0.8 ? "high" : "normal",
          },
        );
        response = await ctx.runAction(
          internal.workflows.routing.handleSupportRequest,
          {
            threadId: args.threadId,
            ticketId: supportTicket.ticketId,
          },
          { retry: true },
        );
        metadata = supportTicket;
        break;

      case "sales_inquiry":
        const salesLead = await ctx.runMutation(
          internal.workflows.routing.createSalesLead,
          {
            inquiry: args.userMessage,
            source: "chat",
          },
        );
        response = await ctx.runAction(
          internal.workflows.routing.handleSalesInquiry,
          {
            threadId: args.threadId,
            leadId: salesLead.leadId,
          },
          { retry: true },
        );
        metadata = salesLead;
        break;

      case "general_question":
      default:
        response = await ctx.runAction(
          internal.workflows.routing.handleGeneralQuestion,
          {
            threadId: args.threadId,
          },
          { retry: true },
        );
        metadata = { type: "general" };
        break;
    }

    return {
      intent: classification.intent,
      response,
      metadata,
    };
  },
});

// Intent classification action
export const classifyIntent = simpleAgent.asObjectAction({
  schema: v.object({
    intent: v.union(
      v.literal("bug_report"),
      v.literal("support_request"),
      v.literal("sales_inquiry"),
      v.literal("general_question"),
    ),
    confidence: v.number(),
    reasoning: v.string(),
  }),
  instructions: `You are an intent classification agent. Analyze the user's message and classify it into one of these categories:

- "bug_report": User is reporting a bug, error, or something not working correctly
- "support_request": User needs help, has a technical question, or needs assistance with the product
- "sales_inquiry": User is interested in pricing, plans, features for purchase, or wants to talk to sales
- "general_question": General questions, casual conversation, or unclear intent

Also provide a confidence score (0-1) and brief reasoning for your classification.`,
  stopWhen: stepCountIs(1),
});

// Bug report handler
export const handleBugReport = simpleAgent.asTextAction({
  instructions: `You are a bug triage assistant. The user has reported a bug and a ticket has been created.
Acknowledge the bug report, provide the ticket ID from the conversation, and ask for any additional details that might be helpful (steps to reproduce, error messages, screenshots, etc.).`,
  stopWhen: stepCountIs(2),
});

// Support request handler
export const handleSupportRequest = simpleAgent.asTextAction({
  instructions: `You are a technical support assistant. A support ticket has been created for the user.
Provide helpful information to address their question, and let them know a support ticket has been created with the ID from the conversation. Offer to help troubleshoot or provide documentation links.`,
  stopWhen: stepCountIs(3),
});

// Sales inquiry handler
export const handleSalesInquiry = simpleAgent.asTextAction({
  instructions: `You are a sales assistant. The user is interested in learning more about the product or pricing.
Provide relevant information about features, pricing, or plans. Let them know a sales representative will follow up, and their inquiry has been logged with the ID from the conversation.`,
  stopWhen: stepCountIs(2),
});

// General question handler
export const handleGeneralQuestion = simpleAgent.asTextAction({
  instructions: `You are a helpful assistant. Answer the user's question in a friendly and informative way.`,
  stopWhen: stepCountIs(2),
});

// Ticket/lead creation mutations
export const createBugTicket = mutation({
  args: { description: v.string(), severity: v.string() },
  handler: async (_ctx, args) => {
    // In a real app, this would create a ticket in your bug tracking system
    const ticketId = `BUG-${Date.now()}`;
    console.log("Created bug ticket:", ticketId, args);
    return { ticketId, severity: args.severity };
  },
});

export const createSupportTicket = mutation({
  args: { description: v.string(), priority: v.string() },
  handler: async (_ctx, args) => {
    // In a real app, this would create a ticket in your support system
    const ticketId = `SUP-${Date.now()}`;
    console.log("Created support ticket:", ticketId, args);
    return { ticketId, priority: args.priority };
  },
});

export const createSalesLead = mutation({
  args: { inquiry: v.string(), source: v.string() },
  handler: async (_ctx, args) => {
    // In a real app, this would create a lead in your CRM
    const leadId = `LEAD-${Date.now()}`;
    console.log("Created sales lead:", leadId, args);
    return { leadId, source: args.source };
  },
});

// Mutation to start the routing workflow
export const startRouting = mutation({
  args: { userMessage: v.string() },
  handler: async (ctx, args): Promise<{ threadId: string; workflowId: string }> => {
    const userId = await getAuthUserId(ctx);
    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: `Routing: ${args.userMessage.slice(0, 50)}`,
    });
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.routing.routingWorkflow,
      { userMessage: args.userMessage, threadId },
    );
    return { threadId, workflowId };
  },
});
