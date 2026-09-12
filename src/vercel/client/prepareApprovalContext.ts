import type { AssistantModelMessage, ModelMessage, ToolModelMessage } from "ai";
import { convexToJson, type Value } from "convex/values";

type AssistantPart = Exclude<AssistantModelMessage["content"], string>[number];
type Request = Extract<AssistantPart, { type: "tool-approval-request" }>;
type Call = Extract<AssistantPart, { type: "tool-call" }>;
type Response = Extract<
  ToolModelMessage["content"][number],
  { type: "tool-approval-response" }
>;
type Result = Extract<
  ToolModelMessage["content"][number],
  { type: "tool-result" }
>;

export function prepareApprovalContext(
  messages: ModelMessage[],
  approvalIds: ReadonlySet<string>,
  storedMessages: ModelMessage[],
): ModelMessage[] {
  const requests = new Map<string, Request>();
  const calls = new Map<string, Call>();
  const responses = new Map<string, Response>();
  const results = new Set<string>();
  const resultMessages = new Map<
    string,
    { part: Result; providerOptions: ToolModelMessage["providerOptions"] }
  >();
  const activeCallIds = new Set(
    messages.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.flatMap((part) =>
            part.type === "tool-approval-request" &&
            approvalIds.has(part.approvalId)
              ? [part.toolCallId]
              : [],
          )
        : [],
    ),
  );

  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (
        part.type === "tool-approval-request" &&
        approvalIds.has(part.approvalId)
      ) {
        if (requests.has(part.approvalId)) {
          throw new Error(
            `Ambiguous approval request ${part.approvalId} in continuation context`,
          );
        }
        requests.set(part.approvalId, part);
      } else if (
        part.type === "tool-approval-request" &&
        activeCallIds.has(part.toolCallId)
      ) {
        throw new Error(
          `Multiple approval requests refer to tool call ${part.toolCallId}`,
        );
      } else if (
        part.type === "tool-call" &&
        activeCallIds.has(part.toolCallId)
      ) {
        if (calls.has(part.toolCallId)) {
          throw new Error(
            `Ambiguous tool call ${part.toolCallId} in continuation context`,
          );
        }
        calls.set(part.toolCallId, part);
      } else if (
        part.type === "tool-approval-response" &&
        approvalIds.has(part.approvalId)
      ) {
        if (responses.has(part.approvalId)) {
          throw new Error(
            `Ambiguous approval response ${part.approvalId} in continuation context`,
          );
        }
        responses.set(part.approvalId, part);
      } else if (
        part.type === "tool-result" &&
        activeCallIds.has(part.toolCallId)
      ) {
        if (results.has(part.toolCallId)) {
          throw new Error(
            `Multiple results for approved tool call ${part.toolCallId}`,
          );
        }
        results.add(part.toolCallId);
        resultMessages.set(part.toolCallId, {
          part,
          providerOptions: message.providerOptions,
        });
      }
    }
  }

  const callIds = new Set(
    [...requests.values()].map((request) => request.toolCallId),
  );
  if (callIds.size !== requests.size) {
    throw new Error(
      "Multiple approval requests refer to the same tool call in continuation context",
    );
  }

  const storedResponseIds = new Set<string>();
  const storedResultIds = new Set<string>();
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
        storedResponseIds.add(part.approvalId);
        supplied = responses.get(part.approvalId);
      } else if (part.type === "tool-call" && callIds.has(part.toolCallId)) {
        supplied = calls.get(part.toolCallId);
      } else if (part.type === "tool-result" && callIds.has(part.toolCallId)) {
        storedResultIds.add(part.toolCallId);
        if (!results.has(part.toolCallId)) {
          throw new Error(
            `Continuation context removed result for ${part.toolCallId}`,
          );
        }
        continue;
      } else {
        continue;
      }
      if (!supplied || signature(supplied) !== signature(part)) {
        throw new Error(
          "Continuation context must preserve stored approval decisions and tool calls",
        );
      }
    }
  }

  if ([...responses.keys()].some((id) => !storedResponseIds.has(id))) {
    throw new Error("Continuation context cannot add approval decisions");
  }
  if ([...results].some((id) => !storedResultIds.has(id))) {
    throw new Error(
      "Continuation context cannot add results for approved tool calls",
    );
  }

  const pending = new Set<string>();
  const deferred = new Set<string>();
  for (const approvalId of approvalIds) {
    const request = requests.get(approvalId);
    if (!request || !calls.has(request.toolCallId)) {
      throw new Error(
        `Approval ${approvalId} is missing its request or tool call in continuation context`,
      );
    }
    if (results.has(request.toolCallId)) continue;
    if (responses.has(approvalId)) pending.add(request.toolCallId);
    else deferred.add(request.toolCallId);
  }

  const assistant: AssistantModelMessage = { role: "assistant", content: [] };
  const tool: ToolModelMessage = { role: "tool", content: [] };
  let assistantOptionsSet = false;
  let toolOptionsSet = false;
  const projected: ModelMessage[] = [];

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      projected.push(message);
      continue;
    }
    const content = message.content.filter((part) => {
      if (
        part.type === "tool-result" &&
        resultMessages.has(part.toolCallId) &&
        !calls.get(part.toolCallId)?.providerExecuted
      ) {
        return false;
      }
      if (
        part.type === "tool-approval-request" &&
        approvalIds.has(part.approvalId) &&
        results.has(part.toolCallId)
      ) {
        return false;
      }
      if (part.type === "tool-call" || part.type === "tool-approval-request") {
        if (deferred.has(part.toolCallId)) return false;
        if (pending.has(part.toolCallId)) {
          if (
            assistantOptionsSet &&
            signature(assistant.providerOptions) !==
              signature(message.providerOptions)
          ) {
            throw new Error(
              "Cannot combine approval calls with different message provider options",
            );
          }
          assistant.providerOptions = message.providerOptions;
          assistantOptionsSet = true;
          (assistant.content as AssistantPart[]).push(part);
          return false;
        }
      }
      if (
        part.type === "tool-approval-response" &&
        approvalIds.has(part.approvalId)
      ) {
        const request = requests.get(part.approvalId)!;
        if (pending.has(request.toolCallId)) {
          if (
            toolOptionsSet &&
            signature(tool.providerOptions) !==
              signature(message.providerOptions)
          ) {
            throw new Error(
              "Cannot combine approval responses with different message provider options",
            );
          }
          tool.providerOptions = message.providerOptions;
          toolOptionsSet = true;
          tool.content.push(part);
        }
        return false;
      }
      return true;
    });

    if (content.length === 0) continue;
    projected.push({ ...message, content } as ModelMessage);
    if (message.role !== "assistant") continue;
    let adjacentResults: ToolModelMessage | undefined;
    for (const part of content) {
      if (part.type !== "tool-call" || part.providerExecuted) continue;
      const result = resultMessages.get(part.toolCallId);
      if (!result) continue;
      if (
        adjacentResults &&
        signature(adjacentResults.providerOptions) ===
          signature(result.providerOptions)
      ) {
        adjacentResults.content.push(result.part);
      } else {
        adjacentResults = {
          role: "tool",
          content: [result.part],
          providerOptions: result.providerOptions,
        };
        projected.push(adjacentResults);
      }
    }
  }

  if (pending.size > 0) projected.push(assistant, tool);
  return projected;
}

function signature(value: unknown): string {
  return JSON.stringify(convexToJson((value ?? null) as Value));
}
