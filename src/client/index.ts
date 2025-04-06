import { api } from "../component/_generated/api";
import { RunActionCtx, RunMutationCtx, RunQueryCtx, UseApi } from "./types";
import type { EmbeddingModelV1, LanguageModelV1 } from "@ai-sdk/provider";
import { Message, MessageStatus, SearchOptions, Step } from "../validators";
import type {
  StreamTextResult,
  Tool,
  ToolSet,
  StepResult,
  Message as UIMessage,
  CoreMessage,
  GenerateObjectResult,
  StreamObjectResult,
  DeepPartial,
  GenerateTextResult,
} from "ai";
import {
  generateText,
  generateObject,
  streamText,
  streamObject,
  convertToCoreMessages,
  coreMessageSchema,
} from "ai";
// TODO: is this the only dependency that needs helpers in client?
import { assert } from "convex-helpers";
import { DEFAULT_MESSAGE_RANGE, extractText } from "../shared";
import { serializeMessage, serializeStep } from "../mapping";

export type ContextOptions = {
  includeToolMessages?: boolean;
  recentMessages?: number;
  searchOptions?: {
    limit: number;
    textSearch?: boolean;
    vectorSearch?: boolean;
    messageRange: { before: number; after: number };
  };
  searchOtherChats?: boolean;
};

export class Agent {
  constructor(
    public component: UseApi<typeof api>,
    public options: {
      name?: string;
      chat: LanguageModelV1;
      textEmbedding?: EmbeddingModelV1<string>;
      defaultSystemPrompt?: string;
      tools?: Record<string, Tool>;
    }
  ) {}

  /**
   * Start a new chat with the agent. This will have a fresh history, though if
   * you pass in a userId you can have it search across other chats for relevant
   * messages as context for the LLM calls.
   * @param ctx The context of the Convex function. From an action, you can chat
   *   with the agent. From a mutation, you can start a chat and save the chatId
   *   to pass to continueChat later.
   * @param args The chat metadata.
   * @returns The chatId of the new chat and the chat object.
   */
  async startChat(
    ctx: RunActionCtx,
    args: {
      /**
       * The userId to associate with the chat. If not provided, the chat will be
       * anonymous.
       */
      userId: string;
      /**
       * Whether the chat is private. If true, the chat will not be visible to
       * other users.
       */
      private?: boolean;
      /**
       * The parent chatIds to merge with.
       * If the chat is a continuation of one or many previous chats,
       * you can pass in the chatIds of the parent chats to merge the histories.
       */
      parentChatIds?: string[];
      /**
       * The title of the chat. Not currently used.
       */
      title?: string;
      /**
       * The summary of the chat. Not currently used.
       */
      summary?: string;
    }
  ): Promise<{
    chatId: string;
    chat: Chat;
  }>;
  /**
   * Start a new chat with the agent. This will have a fresh history, though if
   * you pass in a userId you can have it search across other chats for relevant
   * messages as context for the LLM calls.
   * @param ctx The context of the Convex function. From a mutation, you can
   * start a chat and save the chatId to pass to continueChat later.
   * @param args The chat metadata.
   * @returns The chatId of the new chat.
   */
  async startChat(
    ctx: RunMutationCtx,
    args: {
      userId: string;
      private?: boolean;
      parentChatIds?: string[];
      title?: string;
      summary?: string;
    }
  ): Promise<{
    chatId: string;
  }>;
  async startChat(
    ctx: RunActionCtx | RunMutationCtx,
    args: {
      userId: string;
      private?: boolean;
      parentChatIds?: string[];
      title?: string;
      summary?: string;
    }
  ): Promise<{
    chatId: string;
    chat?: Chat;
  }> {
    const chatDoc = await ctx.runMutation(this.component.messages.createChat, {
      defaultSystemPrompt: this.options.defaultSystemPrompt,
      userId: args.userId,
      title: args.title,
      summary: args.summary,
    });
    if (!("runAction" in ctx)) {
      return { chatId: chatDoc._id };
    }
    const { chat } = await this.continueChat(ctx, {
      chatId: chatDoc._id,
      userId: args.userId,
    });
    return {
      chatId: chatDoc._id,
      chat,
    };
  }

  async continueChat(
    ctx: RunActionCtx,
    {
      chatId,
      userId,
    }: {
      chatId: string;
      userId?: string;
    }
  ): Promise<{
    chat: Chat;
  }> {
    // return this.component.continueChat(ctx, args);
    return {
      chat: {
        generateText: this.generateText.bind(this, ctx, { userId, chatId }),
        streamText: this.streamText.bind(this, ctx, { userId, chatId }),
        generateObject: this.generateObject.bind(this, ctx, { userId, chatId }),
        streamObject: this.streamObject.bind(this, ctx, { userId, chatId }),
      } as Chat,
    };
  }

  async fetchContextMessages(
    ctx: RunQueryCtx | RunActionCtx,
    args: {
      userId?: string;
      chatId?: string;
      messages: CoreMessage[];
    } & ContextOptions
  ): Promise<CoreMessage[]> {
    assert(args.userId || args.chatId, "Specify userId or chatId");
    // Fetch the latest messages from the chat
    const contextMessages: CoreMessage[] = [];
    if (args.searchOptions?.textSearch || args.searchOptions?.vectorSearch) {
      if (!("runAction" in ctx)) {
        throw new Error("searchUserMessages only works in an action");
      }
      const searchMessages = await ctx.runAction(
        this.component.messages.searchMessages,
        {
          userId: args.searchOtherChats ? args.userId : undefined,
          chatId: args.chatId,
          ...(await this.searchWithDefaults(args, args.messages)),
        }
      );
      contextMessages.push(...searchMessages.map((m) => m.message!));
    }
    if (args.chatId) {
      const { messages } = await ctx.runQuery(
        this.component.messages.getChatMessages,
        {
          chatId: args.chatId,
          isTool: args.includeToolMessages ?? false,
          limit: args.recentMessages,
          order: "desc",
          statuses: ["success"],
        }
      );
      contextMessages.push(...messages.map((m) => m.message!));
    }
    return contextMessages;
  }

  async saveMessages(
    ctx: RunMutationCtx,
    args: {
      chatId: string;
      messages: CoreMessage[];
      steps?: StepResult<ToolSet>[];
      addPending: true;
    }
  ): Promise<{
    pendingId: string;
  }>;
  async saveMessages(
    ctx: RunMutationCtx,
    args: {
      chatId: string;
      messages: CoreMessage[];
      steps?: StepResult<ToolSet>[];
      addPending?: boolean;
    }
  ): Promise<{
    pendingId?: string;
  }> {
    const result = await ctx.runMutation(this.component.messages.addMessages, {
      chatId: args.chatId,
      agentName: this.options.name,
      model: this.options.chat.modelId,
      messages: args.messages.map((m) => ({ message: serializeMessage(m) })),
      failPendingSteps: true,
      addPending: args.addPending ?? false,
    });
    return {
      pendingId: result.pending?._id,
    };
  }

  async replaceMessages(
    ctx: RunMutationCtx,
    args: { chatId: string; messages: Message[] }
  ): Promise<void> {
    throw new Error("Not implemented");
  }

  async saveStep<TOOLS extends ToolSet>(
    ctx: RunMutationCtx,
    args: { chatId: string; messageId: string; step: StepResult<TOOLS> }
  ): Promise<void> {
    await ctx.runMutation(this.component.messages.addSteps, {
      chatId: args.chatId,
      messageId: args.messageId,
      steps: [{ step: serializeStep(args.step as StepResult<ToolSet>) }],
      failPreviousSteps: true,
    });
  }

  async completeMessage<TOOLS extends ToolSet>(
    ctx: RunMutationCtx,
    args: {
      chatId: string;
      messageId: string;
      result:
        | { kind: "error"; error: string }
        | {
            kind: "success";
            value: { messages: CoreMessage[]; steps: StepResult<TOOLS>[] };
          };
    }
  ): Promise<void> {
    if (args.result.kind === "success") {
      await ctx.runMutation(this.component.messages.updateMessage, {
        messageId: args.messageId,
        messages: args.result.value.messages.map((m) => ({
          message: serializeMessage(m),
        })),
        steps: args.result.value.steps.map((s) => ({ step: serializeStep(s) })),
      });
    }
  }

  /**
   * This behaves like {@link generateText} except that it add context based on
   * the userId and chatId. It saves the input and resulting messages to the
   * chat, if specified.
   * however. To do that, use {@link continueChat} or {@link saveMessages}.
   * @param ctx The context of the agent.
   * @param args The arguments to the generateText function.
   * @returns The result of the generateText function.
   */
  async generateText<
    TOOLS extends ToolSet,
    OUTPUT = never,
    OUTPUT_PARTIAL = never,
  >(
    ctx: RunActionCtx,
    {
      userId,
      chatId,
      ...searchArgs
    }: {
      userId?: string;
      chatId?: string;
    } & ContextOptions,
    args: Partial<
      Parameters<typeof generateText<TOOLS, OUTPUT, OUTPUT_PARTIAL>>[0]
    >
  ): Promise<GenerateTextResult<TOOLS, OUTPUT>> {
    const { prompt, messages: raw, ...rest } = args;
    const messages = promptOrMessagesToCoreMessages({ prompt, messages: raw });
    const contextMessages = await this.fetchContextMessages(ctx, {
      userId,
      chatId,
      messages,
      ...searchArgs,
    });
    let messageId: string | undefined;
    if (chatId) {
      const { pendingId } = await this.saveMessages(ctx, {
        chatId,
        messages,
        addPending: true,
      });
      messageId = pendingId;
    }
    const result = await generateText({
      model: this.options.chat,
      messages: [...contextMessages, ...messages],
      system: this.options.defaultSystemPrompt,
      ...rest,
      onStepFinish: async (step) => {
        console.log("onStepFinish", step);
        if (chatId && messageId) {
          await this.saveStep(ctx, {
            chatId,
            messageId,
            step,
          });
        }
        return args.onStepFinish?.(step);
      },
    });
    if (messageId && chatId) {
      await this.completeMessage(ctx, {
        messageId,
        chatId,
        result: {
          kind: "success",
          value: {
            messages: result.response.messages,
            steps: result.steps,
          },
        },
      });
    }
    return result;
  }

  async streamText<
    TOOLS extends ToolSet,
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
  >(
    ctx: RunMutationCtx,
    {
      userId,
      chatId,
      ...searchArgs
    }: { userId?: string; chatId?: string } & ContextOptions,
    args: Partial<
      Parameters<typeof streamText<TOOLS, OUTPUT, PARTIAL_OUTPUT>>[0]
    >
  ): Promise<StreamTextResult<TOOLS, PARTIAL_OUTPUT>> {
    const { prompt, messages: raw, ...rest } = args;
    const messages = promptOrMessagesToCoreMessages({ prompt, messages: raw });
    const contextMessages = await this.fetchContextMessages(ctx, {
      userId,
      chatId,
      messages,
      ...searchArgs,
    });
    return streamText({
      model: this.options.chat,
      messages: [...contextMessages, ...messages],
      system: this.options.defaultSystemPrompt,
      ...rest,
      onChunk: async (chunk) => {
        console.log("onChunk", chunk);
        return args.onChunk?.(chunk);
      },
      onError: async (error) => {
        console.error("onError", error);
        return args.onError?.(error);
      },
      onFinish: async (result) => {
        result.response.messages.forEach((message) => {
          console.log("onFinish", message);
        });
        return args.onFinish?.(result);
      },
      onStepFinish: async (step) => {
        console.log("onStepFinish", step);
        return args.onStepFinish?.(step);
      },
    });
  }

  // TODO: not sure why it needs to extend string
  async generateObject<OBJECT extends string>(
    ctx: RunActionCtx,
    {
      userId,
      chatId,
      ...searchArgs
    }: { userId?: string; chatId?: string } & ContextOptions,
    args: Omit<Parameters<typeof generateObject<OBJECT>>[0], "model"> & {
      model?: LanguageModelV1;
    }
  ): Promise<GenerateObjectResult<OBJECT>> {
    const { prompt, messages: raw, ...rest } = args;
    const messages = promptOrMessagesToCoreMessages({ prompt, messages: raw });
    const contextMessages = await this.fetchContextMessages(ctx, {
      userId,
      chatId,
      messages,
      ...searchArgs,
    });
    return generateObject({
      model: this.options.chat,
      messages: [...contextMessages, ...messages],
      ...rest,
    }) as Promise<GenerateObjectResult<OBJECT>>;
  }

  async streamObject<T>(
    ctx: RunMutationCtx,
    {
      userId,
      chatId,
      ...searchArgs
    }: { userId?: string; chatId?: string } & ContextOptions,
    args: Omit<Parameters<typeof streamObject<T>>[0], "model"> & {
      model?: LanguageModelV1;
    }
  ) {
    const { prompt, messages: raw, ...rest } = args;
    const messages = promptOrMessagesToCoreMessages({ prompt, messages: raw });
    const contextMessages = await this.fetchContextMessages(ctx, {
      userId,
      chatId,
      messages,
      ...searchArgs,
    });
    return streamObject<T>({
      model: this.options.chat,
      messages: [...contextMessages, ...messages],
      ...rest,
      onError: async (error) => {
        console.error("onError", error);
        return args.onError?.(error);
      },
      onFinish: async (result) => {
        console.log("onFinish", result);
      },
    }) as StreamObjectResult<DeepPartial<T>, T, never>;
  }

  async searchWithDefaults(
    searchArgs: ContextOptions,
    messages: CoreMessage[]
  ): Promise<SearchOptions> {
    assert(
      searchArgs.searchOptions?.textSearch ||
        searchArgs.searchOptions?.vectorSearch,
      "searchOptions is required"
    );
    assert(messages.length > 0, "Core messages cannot be empty");
    const text = extractText(messages.at(-1)!);
    const search: SearchOptions = {
      limit: searchArgs.searchOptions?.limit ?? 10,
      messageRange: {
        ...DEFAULT_MESSAGE_RANGE,
        ...searchArgs.searchOptions?.messageRange,
      },
      text: extractText(messages.at(-1)!),
    };
    if (
      searchArgs.searchOptions?.vectorSearch &&
      text &&
      this.options.textEmbedding
    ) {
      search.vector = (
        await this.options.textEmbedding.doEmbed({
          values: [text],
        })
      ).embeddings[0];
      search.vectorModel = this.options.textEmbedding.modelId;
    }
    return search;
  }

  async getChatMessages(
    ctx: RunQueryCtx,
    args: {
      chatId: string;
      limit?: number;
      statuses?: MessageStatus[];
      cursor?: string;
      includeToolMessages?: boolean;
      order?: "asc" | "desc";
    }
  ): Promise<{
    messages: (Message & { id: string })[];
    continueCursor?: string;
    isDone: boolean;
  }> {
    const messages = await ctx.runQuery(
      this.component.messages.getChatMessages,
      {
        chatId: args.chatId,
        limit: args.limit,
        statuses: args.statuses,
        cursor: args.cursor,
        isTool: args.includeToolMessages,
        order: args.order,
      }
    );
    return {
      messages: messages.messages
        .map((m) => m && { ...m.message, id: m._id })
        .filter((m): m is Message & { id: string } => m !== undefined),
      continueCursor: messages.continueCursor,
      isDone: messages.isDone,
    };
  }

  async getSteps(
    ctx: RunQueryCtx,
    args: { messageId: string }
  ): Promise<{
    steps: Step[];
  }> {
    return { steps: [] };
  }
}

interface Chat {
  generateText<TOOLS extends ToolSet, OUTPUT = never, OUTPUT_PARTIAL = never>(
    args: Partial<
      Parameters<typeof generateText<TOOLS, OUTPUT, OUTPUT_PARTIAL>>[0]
    >
  ): Promise<GenerateTextResult<TOOLS, OUTPUT>>;
  streamText<TOOLS extends ToolSet, OUTPUT = never, PARTIAL_OUTPUT = never>(
    args: Partial<
      Parameters<typeof streamText<TOOLS, OUTPUT, PARTIAL_OUTPUT>>[0]
    >
  ): Promise<StreamTextResult<TOOLS, PARTIAL_OUTPUT>>;
  generateObject<OBJECT extends string>(
    args: Omit<Parameters<typeof generateObject<OBJECT>>[0], "model"> & {
      model?: LanguageModelV1;
    }
  ): Promise<GenerateObjectResult<OBJECT>>;
  streamObject<T>(
    args: Omit<Parameters<typeof streamObject<T>>[0], "model"> & {
      model?: LanguageModelV1;
    }
  ): Promise<StreamObjectResult<DeepPartial<T>, T, never>>;
}

// type ToolParameters = ZodTypeAny | Schema<unknown>; // TODO: support convex validator
// type inferParameters<PARAMETERS extends ToolParameters> =
//   PARAMETERS extends Schema<unknown>
//     ? PARAMETERS["_type"]
//     : PARAMETERS extends z.ZodTypeAny
//       ? z.infer<PARAMETERS>
//       : never;
// /**
//  * This is a wrapper around the ai.tool function that adds support for
//  * userId and chatId to the tool, if they're called within a chat from an agent.
//  * @param tool The AI tool. See https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling
//  * @returns The same tool, but with userId and chatId args support added.
//  */
// export function tool<PARAMETERS extends ToolParameters, RESULT>(
//   tool: Tool<PARAMETERS, RESULT> & {
//     execute: (
//       args: inferParameters<PARAMETERS> & { userId?: string; chatId?: string },
//       options: ToolExecutionOptions
//     ) => PromiseLike<RESULT>;
//   }
// ): Tool<PARAMETERS, RESULT> & {
//   execute: (
//     args: inferParameters<PARAMETERS>,
//     options: ToolExecutionOptions
//   ) => PromiseLike<RESULT>;
// } {
//   // eslint-disable-next-line @typescript-eslint/no-explicit-any
//   (tool as any).__acceptUserIdAndChatId = true;
//   return tool;
// }

export function promptOrMessagesToCoreMessages(args: {
  system?: string;
  prompt?: string;
  messages?: CoreMessage[] | Omit<UIMessage, "id">[];
}): CoreMessage[] {
  const messages: CoreMessage[] = [];
  if (args.system) {
    messages.push({ role: "system", content: args.system });
  }
  if (!args.messages) {
    assert(args.prompt, "messages or prompt is required");
    messages.push({ role: "user", content: args.prompt });
  } else if (
    args.messages.some(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m.role === "data" || // UI-only role
          "toolInvocations" in m || // UI-specific field
          "parts" in m || // UI-specific field
          "experimental_attachments" in m)
    )
  ) {
    messages.push(...convertToCoreMessages(args.messages as UIMessage[]));
  } else {
    messages.push(...coreMessageSchema.array().parse(args.messages));
  }
  assert(messages.length > 0, "Messages must contain at least one message");
  return messages;
}

// export function convexValidatorSchema<T>(validator: Validator<unknown>)  {
//   return ai.jsonSchema(convexToJsonSchema(validator));
// }
