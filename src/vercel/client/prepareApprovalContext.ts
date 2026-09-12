import type { AssistantModelMessage, ModelMessage, ToolModelMessage } from "ai";
import { convexToJson, type Value } from "convex/values";

type AssistantPart = Exclude<AssistantModelMessage["content"], string>[number];
type Request = Extract<AssistantPart, { type: "tool-approval-request" }>;
type Call = Extract<AssistantPart, { type: "tool-call" }>;
type Response = Extract<
  ToolModelMessage["content"][number],
  { type: "tool-approval-response" }
>;

export function prepareApprovalContext(
  messages: ModelMessage[],
  approvalIds: ReadonlySet<string>,
  storedMessages: ModelMessage[],
): ModelMessage[] {
  const storedRequests = new Map<string, string>();
  const storedResponseIds = new Set<string>();
  const storedResultIds = new Set<string>();
  const providerCallIds = new Set<string>();
  const waitingProviderApprovalIds = new Set<string>();
  const consumedProviderApprovalIds = new Set<string>();
  for (const message of storedMessages) {
    if (!Array.isArray(message.content)) continue;
    if (message.role === "assistant") {
      // Provider-owned approvals do not always produce a tool-result. A later
      // assistant response is the durable evidence that they were consumed.
      for (const approvalId of waitingProviderApprovalIds) {
        consumedProviderApprovalIds.add(approvalId);
      }
      waitingProviderApprovalIds.clear();
    }
    for (const part of message.content) {
      if (part.type === "tool-call" && part.providerExecuted) {
        providerCallIds.add(part.toolCallId);
      } else if (part.type === "tool-approval-request") {
        storedRequests.set(part.approvalId, part.toolCallId);
      } else if (part.type === "tool-approval-response") {
        storedResponseIds.add(part.approvalId);
        if (providerCallIds.has(storedRequests.get(part.approvalId) ?? "")) {
          waitingProviderApprovalIds.add(part.approvalId);
        }
      } else if (part.type === "tool-result") {
        storedResultIds.add(part.toolCallId);
      }
    }
  }
  const activeCallIds = new Set<string>();
  const deferredCallIds = new Set<string>();
  for (const [approvalId, toolCallId] of storedRequests) {
    if (approvalIds.has(approvalId)) {
      activeCallIds.add(toolCallId);
    } else if (
      !storedResultIds.has(toolCallId) &&
      !consumedProviderApprovalIds.has(approvalId)
    ) {
      deferredCallIds.add(toolCallId);
    }
  }

  const requests = new Map<string, Request>();
  const calls = new Map<string, Call>();
  const responses = new Map<string, Response>();
  const resultIds = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        part.type === "tool-approval-request" &&
        approvalIds.has(part.approvalId)
      ) {
        requests.set(part.approvalId, part);
      } else if (
        part.type === "tool-call" &&
        activeCallIds.has(part.toolCallId)
      ) {
        calls.set(part.toolCallId, part);
      } else if (
        part.type === "tool-approval-response" &&
        approvalIds.has(part.approvalId)
      ) {
        responses.set(part.approvalId, part);
      } else if (
        part.type === "tool-result" &&
        activeCallIds.has(part.toolCallId)
      ) {
        resultIds.add(part.toolCallId);
      }
    }
  }

  for (const message of storedMessages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      let supplied: Request | Call | Response | undefined;
      if (
        part.type === "tool-approval-request" &&
        approvalIds.has(part.approvalId)
      ) {
        supplied = requests.get(part.approvalId);
      } else if (
        part.type === "tool-approval-response" &&
        approvalIds.has(part.approvalId)
      ) {
        supplied = responses.get(part.approvalId);
      } else if (
        part.type === "tool-call" &&
        activeCallIds.has(part.toolCallId)
      ) {
        supplied = calls.get(part.toolCallId);
      } else if (
        part.type === "tool-result" &&
        activeCallIds.has(part.toolCallId)
      ) {
        if (!resultIds.has(part.toolCallId)) {
          throw new Error(
            `Continuation context removed result for ${part.toolCallId}`,
          );
        }
        continue;
      } else {
        continue;
      }
      if (
        !supplied ||
        approvalPartSignature(supplied) !== approvalPartSignature(part)
      ) {
        const id =
          part.type === "tool-call"
            ? part.toolCallId
            : `approval ${part.approvalId}`;
        throw new Error(
          `Continuation context must preserve the stored ${part.type} for ${id}`,
        );
      }
    }
  }
  if ([...responses.keys()].some((id) => !storedResponseIds.has(id))) {
    throw new Error("Continuation context cannot add approval decisions");
  }
  if ([...resultIds].some((id) => !storedResultIds.has(id))) {
    throw new Error(
      "Continuation context cannot add results for approved tool calls",
    );
  }

  const executable = new Set<string>();
  const undecided = new Set<string>();
  for (const approvalId of approvalIds) {
    const { toolCallId } = requests.get(approvalId)!;
    if (
      resultIds.has(toolCallId) ||
      consumedProviderApprovalIds.has(approvalId)
    ) {
      continue;
    }
    if (responses.has(approvalId)) executable.add(toolCallId);
    else undecided.add(toolCallId);
  }

  // A handler may clone or reorder the context. The final call/response pair
  // is built once from the canonical parts, so every other occurrence is
  // dropped, and a completed call's result is re-emitted directly after each
  // message that carries the call, so nothing a handler inserts can separate
  // them for providers that require that adjacency.
  const relocated = new Map<string, ToolModelMessage>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result" && activeCallIds.has(part.toolCallId)) {
        relocated.set(part.toolCallId, { ...message, content: [part] });
      }
    }
  }
  const assistantOptions = new OptionsOnce("approval calls");
  const toolOptions = new OptionsOnce("approval responses");
  const projected: ModelMessage[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      projected.push(message);
      continue;
    }
    const content = message.content.filter((part) => {
      if (part.type === "tool-call" || part.type === "tool-approval-request") {
        if (
          deferredCallIds.has(part.toolCallId) ||
          undecided.has(part.toolCallId)
        ) {
          return false;
        }
        if (executable.has(part.toolCallId)) {
          assistantOptions.see(message.providerOptions);
          return false;
        }
        return true;
      }
      if (part.type === "tool-approval-response") {
        const request = requests.get(part.approvalId);
        if (request && executable.has(request.toolCallId)) {
          toolOptions.see(message.providerOptions);
          return false;
        }
        return true;
      }
      if (part.type === "tool-result" && relocated.has(part.toolCallId)) {
        return false;
      }
      return true;
    });
    if (content.length === 0) continue;
    projected.push({ ...message, content } as ModelMessage);
    if (message.role !== "assistant") continue;
    const results = content.flatMap((part) =>
      part.type === "tool-call" && relocated.has(part.toolCallId)
        ? [relocated.get(part.toolCallId)!]
        : [],
    );
    if (results.length > 0) {
      projected.push({
        ...results[0],
        content: results.flatMap((result) => result.content),
      });
    }
  }
  if (executable.size > 0) {
    const assistant: AssistantPart[] = [];
    const tool: Response[] = [];
    for (const approvalId of approvalIds) {
      const request = requests.get(approvalId)!;
      if (!executable.has(request.toolCallId)) continue;
      assistant.push(calls.get(request.toolCallId)!, request);
      tool.push(responses.get(approvalId)!);
    }
    projected.push(
      { role: "assistant", content: assistant, ...assistantOptions.value() },
      { role: "tool", content: tool, ...toolOptions.value() },
    );
  }
  return projected;
}

// Message-level provider options (cache control, for instance) apply to the
// whole message, so parts fused into one message must agree on them.
class OptionsOnce {
  private seen = false;
  private options: ModelMessage["providerOptions"];
  constructor(private readonly what: string) {}
  see(options: ModelMessage["providerOptions"]) {
    if (this.seen && signature(this.options) !== signature(options)) {
      throw new Error(
        `Cannot combine ${this.what} with different message provider options`,
      );
    }
    this.seen = true;
    this.options = options;
  }
  value() {
    return this.options ? { providerOptions: this.options } : {};
  }
}

function approvalPartSignature(part: Request | Call | Response): string {
  if (part.type === "tool-approval-request") {
    return signature({
      type: part.type,
      approvalId: part.approvalId,
      toolCallId: part.toolCallId,
    });
  }
  if (part.type === "tool-call") {
    return signature({
      type: part.type,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.input,
      providerExecuted: part.providerExecuted ?? false,
    });
  }
  return signature({
    type: part.type,
    approvalId: part.approvalId,
    approved: part.approved,
    reason: part.reason,
    providerExecuted: part.providerExecuted ?? false,
  });
}

function signature(value: unknown): string {
  return JSON.stringify(convexToJson((value ?? null) as Value));
}
