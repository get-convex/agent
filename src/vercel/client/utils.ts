import type { Context } from "@ai-sdk/provider-utils";
import type { StepResult, StopCondition, ToolSet } from "ai";

export { errorToString } from "../../errors.js";

/**
 * A stop condition that only matches tool calls which completed
 * successfully (i.e. produced a `tool-result`, not a `tool-error`).
 *
 * Use this instead of the AI SDK's `hasToolCall` when you want the
 * agent to retry on argument validation failures rather than stopping.
 */
export function hasSuccessfulToolCall(toolName: string): StopCondition<any> {
  return ({ steps }) =>
    steps[steps.length - 1]?.toolResults?.some(
      (result) => result.toolName === toolName,
    ) ?? false;
}

export async function willContinue<
  TOOLS extends ToolSet,
  RUNTIME_CONTEXT extends Context,
>(
  steps: StepResult<TOOLS, RUNTIME_CONTEXT>[],
  stopWhen:
    | StopCondition<TOOLS, RUNTIME_CONTEXT>
    | Array<StopCondition<TOOLS, RUNTIME_CONTEXT>>
    | undefined,
): Promise<boolean> {
  const step = steps.at(-1)!;
  // we aren't doing another round after a tool result
  // TODO: whether to handle continuing after too much context used..
  if (step.finishReason !== "tool-calls") return false;
  // Count both successful results and errors as completed outputs.
  // Failed tool calls are represented as tool-error content parts, so only
  // checking toolResults misses them.
  const completedOutputs =
    step.content?.filter(
      (p) => p.type === "tool-result" || p.type === "tool-error",
    ).length ?? step.toolResults.length;
  // we don't have a tool result, so we'll wait for more
  if (step.toolCalls.length > completedOutputs) return false;
  if (Array.isArray(stopWhen)) {
    return (await Promise.all(stopWhen.map(async (s) => s({ steps })))).every(
      (stop) => !stop,
    );
  }
  return !!stopWhen && !(await stopWhen({ steps }));
}
