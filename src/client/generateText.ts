import type {
  GenerateTextResult,
  StepResult,
  ToolSet,
} from "ai";
import { generateText as generateTextAi } from "ai";
import type {
  ActionCtx,
  AgentComponent,
  AgentPrompt,
  GenerationOutputMetadata,
  Options,
  Output,
} from "./types.js";
import { startGeneration } from "./start.js";
import type { Agent } from "./index.js";
import { errorToString, willContinue } from "./utils.js";

/**
 * This behaves like {@link generateText} from the "ai" package except that
 * it adds context based on the userId and threadId and saves the input and
 * resulting messages to the thread, if specified.
 *
 * This is the standalone version — it requires all arguments explicitly.
 * For the Agent-bound version that inherits model/tools/instructions from
 * the Agent config, use `agent.generateText()`.
 */
export async function generateText<
  TOOLS extends ToolSet,
  OUTPUT extends Output<any, any, any> = never,
>(
  ctx: ActionCtx,
  component: AgentComponent,
  /**
   * The arguments to the generateText function, similar to the ai sdk's
   * {@link generateText} function, along with Agent prompt options.
   */
  generateTextArgs: AgentPrompt &
    Omit<
      Parameters<typeof generateTextAi<TOOLS, OUTPUT>>[0],
      "model" | "prompt" | "messages"
    > & {
      /**
       * The tools to use for the tool calls.
       */
      tools?: TOOLS;
    },
  /**
   * The {@link Options} to use for fetching contextual messages
   * and saving input/output messages.
   */
  options: Options & {
    agentName: string;
    userId?: string | null;
    threadId?: string;
    agentForToolCtx?: Agent;
  },
): Promise<GenerateTextResult<TOOLS, OUTPUT> & GenerationOutputMetadata> {
  const { args, promptMessageId, order, ...call } =
    await startGeneration(ctx, component, generateTextArgs, options);

  const steps: StepResult<TOOLS>[] = [];
  try {
    const result = (await generateTextAi<TOOLS, OUTPUT>({
      ...args,
      prepareStep: async (options) => {
        const result = await generateTextArgs.prepareStep?.(options);
        call.updateModel(result?.model ?? options.model);
        return result;
      },
      onStepFinish: async (step) => {
        steps.push(step);
        await call.save({ step }, await willContinue(steps, args.stopWhen));
        return generateTextArgs.onStepFinish?.(step);
      },
    })) as GenerateTextResult<TOOLS, OUTPUT>;
    const metadata: GenerationOutputMetadata = {
      promptMessageId,
      order,
      savedMessages: call.getSavedMessages(),
      messageId: promptMessageId,
    };
    return Object.assign(result, metadata);
  } catch (error) {
    await call.fail(errorToString(error));
    throw error;
  }
}
