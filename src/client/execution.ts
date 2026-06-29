import type { PaginationResult } from "convex/server";
import type { Value } from "convex/values";
import { parse } from "convex-helpers/validators";
import type {
  AgentError,
  AgentMessageDoc,
  AgentMessagePart,
  AgentRunEvent,
  AgentStatus,
  AgentToolCall,
  AgentUsage,
} from "../validators.js";
import {
  toComponentMessageId,
  toComponentRunId,
  type AgentComponent,
  type AgentExecutionCtx,
} from "./componentRefs.js";
import { normalizeMessage } from "./messageInput.js";
import type {
  AgentContextBlock,
  AgentContextLoader,
  AgentModel,
  AgentOptions,
  AgentRun,
  AgentTool,
  AgentToolContext,
  AnyAgentTools,
  ExecuteArgs,
  ListMessagesArgs,
} from "./index.js";

function errorToAgentError(error: unknown): AgentError {
  if (error instanceof Error) {
    return { code: error.name || "error", message: error.message };
  }
  return { code: "error", message: String(error) };
}

function isTerminal(status: AgentStatus): boolean {
  return status === "success" || status === "failed" || status === "canceled";
}

async function needsApproval(
  tool: AgentTool,
  input: Value,
  context: AgentToolContext,
) {
  if (typeof tool.needsApproval === "function") {
    return await tool.needsApproval(input, context);
  }
  return tool.needsApproval === true;
}

function parseToolInput(tool: AgentTool, input: Value) {
  return tool.input ? (parse(tool.input, input) as Value) : input;
}

function contextLoaders(
  loaders: AgentContextLoader | AgentContextLoader[] | undefined,
) {
  if (!loaders) {
    return [];
  }
  return Array.isArray(loaders) ? loaders : [loaders];
}

function newExecutionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

type LoadedExecutionContext = {
  contextMessages: AgentMessageDoc[];
  context: AgentContextBlock[];
  toolCalls: Map<string, AgentToolCall>;
};

export class AgentRunExecution<Tools extends AnyAgentTools = AnyAgentTools> {
  private readonly executionId = newExecutionId();
  private run: AgentRun | undefined;
  private nextEventSequence = 0;
  private resultMessageIds: string[] = [];
  private contentParts: AgentMessagePart[] = [];
  private usage: AgentUsage | undefined;
  private emittedDone = false;
  private stoppedRun: AgentRun | undefined;

  constructor(
    private readonly input: {
      component: AgentComponent;
      options: AgentOptions<Tools>;
      ctx: AgentExecutionCtx;
      args: ExecuteArgs<Tools>;
      model: AgentModel<Tools>;
      listMessages: (args: ListMessagesArgs) => Promise<PaginationResult<AgentMessageDoc>>;
    },
  ) {}

  async execute(): Promise<AgentRun> {
    const claim = await this.input.ctx.runMutation(
      this.input.component.runs.beginExecution,
      {
        runId: toComponentRunId(this.input.args.runId),
        executionId: this.executionId,
      },
    );
    this.run = claim.run;
    if (
      !claim.claimed ||
      isTerminal(this.run.status) ||
      this.run.status !== "running"
    ) {
      return this.run;
    }
    this.nextEventSequence = claim.nextEventSequence;
    this.resultMessageIds = [...(this.run.resultMessageIds ?? [])];

    try {
      const loaded = await this.loadContext();
      return await this.executeModel(loaded);
    } catch (error) {
      return await this.fail(error);
    }
  }

  private currentRun(): AgentRun {
    if (!this.run) {
      throw new Error("Run execution has not been claimed");
    }
    return this.run;
  }

  private setStoppedRun(run: AgentRun) {
    if (isTerminal(run.status)) {
      this.stoppedRun = run;
      return true;
    }
    return false;
  }

  private async stopIfNeeded() {
    return this.stoppedRun ?? (await this.cancelForSignal());
  }

  private async cancelForSignal() {
    const run = this.currentRun();
    if (!this.input.args.signal?.aborted || this.stoppedRun) {
      return this.stoppedRun;
    }
    this.stoppedRun = await this.input.ctx.runMutation(
      this.input.component.runs.cancel,
      {
        runId: toComponentRunId(run.runId),
        reason: "Execution aborted.",
      },
    );
    return this.stoppedRun;
  }

  private async loadContext(): Promise<LoadedExecutionContext> {
    const run = this.currentRun();
    const contextPage = await this.input.listMessages({
      threadId: run.threadId,
      order: "desc",
      excludeToolMessages: this.input.args.excludeToolMessages,
      paginationOpts: {
        cursor: null,
        numItems: this.input.args.recentMessages ?? 100,
      },
    });
    const contextMessages = [...contextPage.page].reverse();
    const promptMessage = run.messageId
      ? (
          await this.input.ctx.runQuery(
            this.input.component.messages.getMessagesByIds,
            {
              messageIds: [toComponentMessageId(run.messageId)],
            },
          )
        )[0] ?? undefined
      : undefined;
    const context: AgentContextBlock[] = [];
    for (const loader of contextLoaders(this.input.args.context)) {
      context.push(
        ...(await loader(this.input.ctx, {
          run,
          promptMessage,
          recentMessages: contextMessages,
        })),
      );
    }
    const toolCalls = new Map(
      (
        await this.input.ctx.runQuery(this.input.component.runs.listToolCalls, {
          runId: toComponentRunId(run.runId),
        })
      ).map((call) => [call.toolCallId, call]),
    );
    return { contextMessages, context, toolCalls };
  }

  private async executeModel(loaded: LoadedExecutionContext) {
    const run = this.currentRun();
    for await (const event of this.input.model.execute({
      run,
      messages: loaded.contextMessages,
      context: loaded.context,
      tools: this.tools(),
      signal: this.input.args.signal,
    })) {
      const stopped = await this.stopIfNeeded();
      if (stopped) {
        return stopped;
      }
      const result = await this.handleEvent(event, loaded.toolCalls);
      if (result) {
        return result;
      }
    }
    return await this.finish();
  }

  private tools() {
    return this.input.args.tools ?? this.input.options.tools;
  }

  private resolveTool(name: string) {
    const tools = this.tools();
    return tools && name in tools
      ? (tools as AnyAgentTools)[name]
      : undefined;
  }

  private async handleEvent(
    event: AgentRunEvent,
    toolCalls: Map<string, AgentToolCall>,
  ): Promise<AgentRun | undefined> {
    switch (event.type) {
      case "text.delta":
        return await this.handleTextDelta(event);
      case "reasoning.delta":
        return await this.handleReasoningDelta(event);
      case "source":
        return await this.handleSource(event);
      case "file":
        return await this.handleFile(event);
      case "tool.call":
        return await this.handleToolCall(event, toolCalls);
      case "tool.result":
        return await this.handleToolResult(event, toolCalls);
      case "approval.request":
        return await this.handleApprovalRequest(event);
      case "data":
      case "output":
        return await this.recordOnly(event);
      case "usage":
        return await this.handleUsage(event);
      case "error":
        return await this.handleError(event);
      case "message":
        return await this.handleMessage(event);
      case "done":
        return await this.handleDone(event);
    }
  }

  private async recordEvent(event: AgentRunEvent) {
    const run = this.currentRun();
    const stopped = await this.stopIfNeeded();
    if (stopped) {
      return { materialize: false };
    }
    const validatedEvent =
      event.type === "output" && this.input.options.output
        ? {
            ...event,
            value: parse(this.input.options.output, event.value) as Value,
          }
        : event;
    const startSequence = this.nextEventSequence;
    const receipt = await this.input.ctx.runMutation(
      this.input.component.runs.appendEvents,
      {
        runId: toComponentRunId(run.runId),
        executionId: this.executionId,
        startSequence,
        events: [validatedEvent],
      },
    );
    if (receipt.stopped) {
      this.setStoppedRun(receipt.run);
      return { materialize: false };
    }
    this.nextEventSequence = receipt.nextEventSequence;
    return { materialize: true };
  }

  private async saveBufferedMessage() {
    const run = this.currentRun();
    if (this.contentParts.length === 0 || (await this.stopIfNeeded())) {
      return;
    }
    const updated = await this.input.ctx.runMutation(
      this.input.component.runs.saveResultMessages,
      {
        runId: toComponentRunId(run.runId),
        executionId: this.executionId,
        messages: [
          {
            message: {
              author: { type: "agent", name: this.input.options.name },
              content: [...this.contentParts],
            },
            status: "success",
            usage: this.usage,
          },
        ],
      },
    );
    if (this.setStoppedRun(updated)) {
      return;
    }
    this.resultMessageIds = [...(updated.resultMessageIds ?? [])];
    this.contentParts = [];
    this.usage = undefined;
  }

  private async requestApproval(events: AgentRunEvent[], toolCallId: string) {
    const run = this.currentRun();
    const stopped = await this.stopIfNeeded();
    if (stopped) {
      return stopped;
    }
    const waiting = await this.input.ctx.runMutation(
      this.input.component.runs.requestApproval,
      {
        runId: toComponentRunId(run.runId),
        executionId: this.executionId,
        startSequence: this.nextEventSequence,
        events,
        toolCallIds: [toolCallId],
      },
    );
    this.setStoppedRun(waiting);
    this.nextEventSequence += events.length;
    return waiting;
  }

  private async recordAndMaterialize(
    event: AgentRunEvent,
    onMaterialize: () => void,
  ): Promise<AgentRun | undefined> {
    const recorded = await this.recordEvent(event);
    const stopped = await this.stopIfNeeded();
    if (stopped) return stopped;
    if (recorded.materialize) {
      onMaterialize();
    }
    return undefined;
  }

  private async handleTextDelta(
    event: Extract<AgentRunEvent, { type: "text.delta" }>,
  ) {
    return await this.recordAndMaterialize(event, () => {
      const last = this.contentParts.at(-1);
      if (last?.type === "text") {
        last.text += event.text;
      } else {
        this.contentParts.push({ type: "text", text: event.text });
      }
    });
  }

  private async handleReasoningDelta(
    event: Extract<AgentRunEvent, { type: "reasoning.delta" }>,
  ) {
    return await this.recordAndMaterialize(event, () => {
      const last = this.contentParts.at(-1);
      if (last?.type === "reasoning") {
        last.text += event.text;
      } else {
        this.contentParts.push({ type: "reasoning", text: event.text });
      }
    });
  }

  private async handleSource(
    event: Extract<AgentRunEvent, { type: "source" }>,
  ) {
    return await this.recordAndMaterialize(event, () => {
      this.contentParts.push({ ...event.source, type: "source" });
    });
  }

  private async handleFile(event: Extract<AgentRunEvent, { type: "file" }>) {
    return await this.recordAndMaterialize(event, () => {
      this.contentParts.push({ ...event.file, type: "file" });
    });
  }

  private async handleToolCall(
    event: Extract<AgentRunEvent, { type: "tool.call" }>,
    toolCalls: Map<string, AgentToolCall>,
  ) {
    const run = this.currentRun();
    const tool = this.resolveTool(event.name);
    if (!tool) {
      throw new Error(`Tool not found: ${event.name}`);
    }
    const input = parseToolInput(tool, event.input);
    const existingToolCall = toolCalls.get(event.toolCallId);
    const toolContext: AgentToolContext = {
      ctx: this.input.ctx,
      run,
      runId: run.runId,
      threadId: run.threadId,
      userId: run.userId,
      toolCallId: event.toolCallId,
      name: event.name,
      signal: this.input.args.signal,
    };
    if (existingToolCall?.status === "success") {
      return undefined;
    }
    if (existingToolCall?.approved === false) {
      this.contentParts.push({
        type: "tool-result",
        toolCallId: event.toolCallId,
        name: event.name,
        error: {
          code: "execution-denied",
          message: existingToolCall.reason ?? "Tool call denied.",
        },
      });
      return undefined;
    }
    if (existingToolCall?.status === "waiting") {
      throw new Error(
        `Tool call ${event.toolCallId} is still waiting for approval`,
      );
    }
    if (
      existingToolCall?.status !== "pending" &&
      (await needsApproval(tool, input, toolContext))
    ) {
      return await this.waitForToolApproval(event, input, existingToolCall);
    }
    if (!existingToolCall) {
      const recorded = await this.recordEvent({ ...event, input });
      const stopped = await this.stopIfNeeded();
      if (stopped) return stopped;
      if (recorded.materialize) {
        this.contentParts.push({
          type: "tool-call",
          toolCallId: event.toolCallId,
          name: event.name,
          input,
        });
      }
    }
    const stoppedBeforeTool = await this.stopIfNeeded();
    if (stoppedBeforeTool) return stoppedBeforeTool;
    const output = await tool.execute(input, toolContext);
    const stoppedAfterTool = await this.stopIfNeeded();
    if (stoppedAfterTool) return stoppedAfterTool;
    return await this.recordToolResult(
      event,
      input,
      output,
      existingToolCall,
      toolCalls,
    );
  }

  private async waitForToolApproval(
    event: Extract<AgentRunEvent, { type: "tool.call" }>,
    input: Value,
    existingToolCall: AgentToolCall | undefined,
  ) {
    const toolCallEvent = { ...event, input };
    const approvalEvent: AgentRunEvent = {
      type: "approval.request",
      approvalId: `approval:${event.toolCallId}`,
      toolCallId: event.toolCallId,
      name: event.name,
      input,
    };
    this.contentParts.push({
      type: "tool-call",
      toolCallId: event.toolCallId,
      name: event.name,
      input,
    });
    this.contentParts.push({
      type: "approval-request",
      approvalId: approvalEvent.approvalId,
      toolCallId: event.toolCallId,
    });
    await this.saveBufferedMessage();
    return await this.requestApproval(
      existingToolCall ? [approvalEvent] : [toolCallEvent, approvalEvent],
      event.toolCallId,
    );
  }

  private async recordToolResult(
    event: Extract<AgentRunEvent, { type: "tool.call" }>,
    input: Value,
    output: Value,
    existingToolCall: AgentToolCall | undefined,
    toolCalls: Map<string, AgentToolCall>,
  ) {
    const run = this.currentRun();
    const resultEvent: AgentRunEvent = {
      type: "tool.result",
      toolCallId: event.toolCallId,
      name: event.name,
      output,
    };
    const recorded = await this.recordEvent(resultEvent);
    const stopped = await this.stopIfNeeded();
    if (stopped) return stopped;
    toolCalls.set(event.toolCallId, {
      toolCallId: event.toolCallId,
      runId: run.runId,
      name: event.name,
      input,
      status: "success",
      output,
      approved: existingToolCall?.approved,
      approvalId: existingToolCall?.approvalId,
      requestedAt: existingToolCall?.requestedAt ?? 0,
      resolvedAt: existingToolCall?.resolvedAt,
    });
    if (recorded.materialize) {
      this.contentParts.push({
        type: "tool-result",
        toolCallId: event.toolCallId,
        name: event.name,
        output,
      });
    }
    return undefined;
  }

  private async handleToolResult(
    event: Extract<AgentRunEvent, { type: "tool.result" }>,
    toolCalls: Map<string, AgentToolCall>,
  ) {
    const run = this.currentRun();
    const recorded = await this.recordEvent(event);
    const stopped = await this.stopIfNeeded();
    if (stopped) return stopped;
    toolCalls.set(event.toolCallId, {
      toolCallId: event.toolCallId,
      runId: run.runId,
      name: event.name ?? "unknown",
      input: null,
      status: event.error ? "failed" : "success",
      output: event.output,
      error: event.error,
      requestedAt: 0,
    });
    if (recorded.materialize) {
      this.contentParts.push({
        type: "tool-result",
        toolCallId: event.toolCallId,
        name: event.name,
        output: event.output,
        error: event.error,
      });
    }
    return undefined;
  }

  private async handleApprovalRequest(
    event: Extract<AgentRunEvent, { type: "approval.request" }>,
  ) {
    const tool = this.resolveTool(event.name);
    if (!tool) {
      throw new Error(`Tool not found: ${event.name}`);
    }
    const input = parseToolInput(tool, event.input);
    const approvalEvent = { ...event, input };
    this.contentParts.push({
      type: "approval-request",
      approvalId: approvalEvent.approvalId,
      toolCallId: approvalEvent.toolCallId,
    });
    await this.saveBufferedMessage();
    return await this.requestApproval([approvalEvent], approvalEvent.toolCallId);
  }

  private async recordOnly(event: AgentRunEvent) {
    await this.recordEvent(event);
    return await this.stopIfNeeded();
  }

  private async handleUsage(
    event: Extract<AgentRunEvent, { type: "usage" }>,
  ) {
    return await this.recordAndMaterialize(event, () => {
      this.usage = event.usage;
    });
  }

  private async handleError(
    event: Extract<AgentRunEvent, { type: "error" }>,
  ): Promise<never> {
    await this.recordEvent(event);
    throw new Error(event.error.message);
  }

  private async handleMessage(
    event: Extract<AgentRunEvent, { type: "message" }>,
  ) {
    const run = this.currentRun();
    const recorded = await this.recordEvent(event);
    let stopped = await this.stopIfNeeded();
    if (stopped) return stopped;
    await this.saveBufferedMessage();
    stopped = await this.stopIfNeeded();
    if (stopped) return stopped;
    if (!recorded.materialize) return undefined;
    this.usage = event.message.usage ?? this.usage;
    const updated = await this.input.ctx.runMutation(
      this.input.component.runs.saveResultMessages,
      {
        runId: toComponentRunId(run.runId),
        executionId: this.executionId,
        messages: [normalizeMessage(event.message)],
      },
    );
    if (this.setStoppedRun(updated)) {
      return updated;
    }
    this.resultMessageIds = [...(updated.resultMessageIds ?? [])];
    return undefined;
  }

  private async handleDone(event: Extract<AgentRunEvent, { type: "done" }>) {
    const stopped = await this.recordAndMaterialize(event, () => {
      this.usage = event.usage ?? this.usage;
    });
    if (stopped) return stopped;
    this.emittedDone = true;
    return undefined;
  }

  private async finish() {
    const run = this.currentRun();
    await this.saveBufferedMessage();
    let stopped = await this.stopIfNeeded();
    if (stopped) {
      return stopped;
    }
    if (!this.emittedDone) {
      await this.recordEvent({ type: "done", usage: this.usage });
      stopped = await this.stopIfNeeded();
      if (stopped) {
        return stopped;
      }
    }
    return await this.input.ctx.runMutation(this.input.component.runs.finish, {
      runId: toComponentRunId(run.runId),
      executionId: this.executionId,
      resultMessageIds: this.resultMessageIds.map(toComponentMessageId),
    });
  }

  private async fail(error: unknown) {
    const run = this.currentRun();
    if (this.input.args.signal?.aborted) {
      return (await this.cancelForSignal()) ?? this.stoppedRun!;
    }
    if (this.stoppedRun) {
      return this.stoppedRun;
    }
    return await this.input.ctx.runMutation(this.input.component.runs.fail, {
      runId: toComponentRunId(run.runId),
      executionId: this.executionId,
      error: errorToAgentError(error),
    });
  }
}

