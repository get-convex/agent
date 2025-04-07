import type { EmbeddingModelV1, LanguageModelV1 } from "@ai-sdk/provider";
import type {
  CoreMessage,
  DeepPartial,
  GenerateObjectResult,
  GenerateTextResult,
  StepResult,
  StreamObjectResult,
  StreamTextResult,
  Tool,
  ToolChoice,
  ToolExecutionOptions,
  ToolSet,
  Message as UIMessage,
} from "ai";
import {
  convertToCoreMessages,
  coreMessageSchema,
  generateObject,
  generateText,
  streamObject,
  streamText,
} from "ai";
import { api } from "../component/_generated/api";
import { Message, MessageStatus, SearchOptions } from "../validators";
import { RunActionCtx, RunMutationCtx, RunQueryCtx, UseApi } from "./types";
// TODO: is this the only dependency that needs helpers in client?
import { assert } from "convex-helpers";
import { ConvexToZod, convexToZod } from "convex-helpers/server/zod";
import { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, Validator } from "convex/values";
import {
  serializeMessageWithId,
  serializeNewMessagesInStep,
  serializeStep,
} from "../mapping";
import { DEFAULT_MESSAGE_RANGE, extractText } from "../shared";

export type ContextOptions = {
  parentMessageId?: string;
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

export type StorageOptions = {
  // Defaults to false, allowing you to pass in arbitrary context that will
  // be in addition to automatically fetched content.
  // Pass true to have all input messages saved to the chat history.
  saveAllInputMessages?: boolean;
  // Defaults to true
  saveOutputMessages?: boolean;
};

export type GenerationOutputMetadata = { messageId: string };

type CoreMessageMaybeWithId = CoreMessage & { id?: string | undefined };

export class Agent<AgentTools extends ToolSet> {
  constructor(
    public component: UseApi<typeof api>,
    public options: {
      name?: string;
      chat: LanguageModelV1;
      textEmbedding?: EmbeddingModelV1<string>;
      defaultSystemPrompt?: string;
      tools?: AgentTools;
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
      userId?: string;
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
    chat: Chat<AgentTools>;
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
      userId?: string;
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
      parentChatIds?: string[];
      title?: string;
      summary?: string;
    }
  ): Promise<{
    chatId: string;
    chat?: Chat<AgentTools>;
  }> {
    const chatDoc = await ctx.runMutation(this.component.messages.createChat, {
      defaultSystemPrompt: this.options.defaultSystemPrompt,
      userId: args.userId,
      title: args.title,
      summary: args.summary,
      parentChatIds: args.parentChatIds,
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
    chat: Chat<AgentTools>;
  }> {
    // return this.component.continueChat(ctx, args);
    return {
      chat: {
        generateText: this.generateText.bind(this, ctx, { userId, chatId }),
        streamText: this.streamText.bind(this, ctx, { userId, chatId }),
        generateObject: this.generateObject.bind(this, ctx, { userId, chatId }),
        streamObject: this.streamObject.bind(this, ctx, { userId, chatId }),
      } as Chat<AgentTools>,
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
          parentMessageId: args.parentMessageId,
          ...(await this.searchOptionsWithDefaults(args, args.messages)),
        }
      );
      // TODO: track what messages we used for context
      contextMessages.push(...searchMessages.map((m) => m.message!));
    }
    if (args.chatId) {
      const { messages } = await ctx.runQuery(
        this.component.messages.getChatMessages,
        {
          chatId: args.chatId,
          isTool: args.includeToolMessages ?? false,
          limit: args.recentMessages,
          parentMessageId: args.parentMessageId,
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
      messages: CoreMessageMaybeWithId[];
      pending?: boolean;
      parentMessageId?: string;
    }
  ): Promise<{
    lastMessageId: string;
    messageIds: string[];
  }> {
    const result = await ctx.runMutation(this.component.messages.addMessages, {
      chatId: args.chatId,
      agentName: this.options.name,
      model: this.options.chat.modelId,
      messages: args.messages.map(serializeMessageWithId),
      failPendingSteps: true,
      pending: args.pending ?? false,
      parentMessageId: args.parentMessageId,
    });
    return {
      lastMessageId: result.messages.at(-1)!._id,
      messageIds: result.messages.map((m) => m._id),
    };
  }

  async saveStep<TOOLS extends ToolSet>(
    ctx: RunMutationCtx,
    args: { chatId: string; messageId: string; step: StepResult<TOOLS> }
  ): Promise<void> {
    const step = serializeStep(args.step as StepResult<ToolSet>);
    const messages = serializeNewMessagesInStep(args.step);
    await ctx.runMutation(this.component.messages.addSteps, {
      chatId: args.chatId,
      messageId: args.messageId,
      steps: [{ step, messages: messages }],
      failPendingSteps: false,
    });
  }

  // If you manually create a message, call this to either commit or reset it.
  async completeMessage<TOOLS extends ToolSet>(
    ctx: RunMutationCtx,
    args: {
      chatId: string;
      messageId: string;
      result:
        | { kind: "error"; error: string }
        | { kind: "success"; value: { steps: StepResult<TOOLS>[] } };
    }
  ): Promise<void> {
    const result = args.result;
    if (result.kind === "success") {
      await ctx.runMutation(this.component.messages.commitMessage, {
        messageId: args.messageId,
      });
    } else {
      await ctx.runMutation(this.component.messages.addSteps, {
        chatId: args.chatId,
        messageId: args.messageId,
        steps: [],
        failPendingSteps: true,
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
    }: {
      userId?: string;
      chatId: string;
    },
    args: TextArgs<
      AgentTools,
      TOOLS,
      Parameters<typeof generateText<TOOLS, OUTPUT, OUTPUT_PARTIAL>>[0]
    >
  ): Promise<
    GenerateTextResult<TOOLS & AgentTools, OUTPUT> & GenerationOutputMetadata
  > {
    const { prompt, messages: raw, ...rest } = args;
    const messages = promptOrMessagesToCoreMessages({ prompt, messages: raw });
    const contextMessages = await this.fetchContextMessages(ctx, {
      ...args,
      userId,
      chatId,
      messages,
    });
    const { lastMessageId: messageId } = await this.saveMessages(ctx, {
      chatId,
      messages: args.saveAllInputMessages ? messages : messages.slice(-1),
      pending: true,
      parentMessageId: args.parentMessageId,
    });
    const defaults = this.options.tools;
    const tools = wrapTools(ctx, chatId, userId, defaults, args.tools) as TOOLS;
    try {
      const result = await generateText({
        model: this.options.chat,
        messages: [...contextMessages, ...messages],
        system: this.options.defaultSystemPrompt,
        tools,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        toolChoice: args.toolChoice as any,
        ...rest,
        onStepFinish: async (step) => {
          if (chatId && messageId && args.saveOutputMessages) {
            await this.saveStep(ctx, {
              chatId,
              messageId,
              step,
            });
          }
          return args.onStepFinish?.(step);
        },
      });
      return { ...result, messageId };
    } catch (error) {
      if (chatId && messageId) {
        await ctx.runMutation(this.component.messages.rollbackMessage, {
          messageId,
          error: (error as Error).message,
        });
      }
      throw error;
    }
  }

  async streamText<
    TOOLS extends ToolSet,
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
  >(
    ctx: RunActionCtx,
    { userId, chatId }: { userId?: string; chatId: string },
    args: Partial<
      Parameters<typeof streamText<TOOLS, OUTPUT, PARTIAL_OUTPUT>>[0]
    > &
      ContextOptions &
      StorageOptions
  ): Promise<
    StreamTextResult<TOOLS, PARTIAL_OUTPUT> & GenerationOutputMetadata
  > {
    const { prompt, messages: raw, ...rest } = args;
    const messages = promptOrMessagesToCoreMessages({ prompt, messages: raw });
    const contextMessages = await this.fetchContextMessages(ctx, {
      ...args,
      userId,
      chatId,
      messages,
    });
    const { lastMessageId: messageId } = await this.saveMessages(ctx, {
      chatId,
      messages: args.saveAllInputMessages ? messages : messages.slice(-1),
      pending: true,
      parentMessageId: args.parentMessageId,
    });
    const defaults = this.options.tools;
    const tools = wrapTools(ctx, chatId, userId, defaults, args.tools) as TOOLS;
    const result = streamText({
      model: this.options.chat,
      messages: [...contextMessages, ...messages],
      system: this.options.defaultSystemPrompt,
      tools,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolChoice: args.toolChoice as any,
      ...rest,
      onChunk: async (chunk) => {
        console.log("onChunk", chunk);
        return args.onChunk?.(chunk);
      },
      onError: async (error) => {
        console.error("onError", error);
        if (chatId && messageId) {
          await ctx.runMutation(this.component.messages.rollbackMessage, {
            messageId,
            error: (error.error as Error).message,
          });
        }
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
    return { ...result, messageId };
  }

  // TODO: add the crazy number of overloads to get types through
  async generateObject<T>(
    ctx: RunActionCtx,
    { userId, chatId }: { userId?: string; chatId: string },
    args: Omit<Parameters<typeof generateObject>[0], "model"> & {
      model?: LanguageModelV1;
    } & ContextOptions &
      StorageOptions
  ): Promise<GenerateObjectResult<T> & GenerationOutputMetadata> {
    const { prompt, messages: raw, ...rest } = args;
    const messages = promptOrMessagesToCoreMessages({ prompt, messages: raw });
    const contextMessages = await this.fetchContextMessages(ctx, {
      ...args,
      userId,
      chatId,
      messages,
    });
    const { lastMessageId: messageId } = await this.saveMessages(ctx, {
      chatId,
      messages: args.saveAllInputMessages ? messages : messages.slice(-1),
      pending: true,
    });
    const result = (await generateObject({
      model: this.options.chat,
      messages: [...contextMessages, ...messages],
      ...rest,
    })) as GenerateObjectResult<T>;
    return { ...result, messageId };
  }

  async streamObject<T>(
    ctx: RunMutationCtx,
    { userId, chatId }: { userId?: string; chatId: string },
    args: Omit<Parameters<typeof streamObject<T>>[0], "model"> & {
      model?: LanguageModelV1;
    } & ContextOptions &
      StorageOptions
  ): Promise<
    StreamObjectResult<DeepPartial<T>, T, never> & GenerationOutputMetadata
  > {
    const { prompt, messages: raw, ...rest } = args;
    const messages = promptOrMessagesToCoreMessages({ prompt, messages: raw });
    const contextMessages = await this.fetchContextMessages(ctx, {
      ...args,
      userId,
      chatId,
      messages,
    });
    const { lastMessageId: messageId } = await this.saveMessages(ctx, {
      chatId,
      messages: args.saveAllInputMessages ? messages : messages.slice(-1),
      pending: true,
    });
    const result = streamObject<T>({
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
    return { ...result, messageId };
  }

  async searchOptionsWithDefaults(
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
}

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

type TextArgs<
  AgentTools extends ToolSet,
  TOOLS extends ToolSet,
  T extends {
    toolChoice?: ToolChoice<TOOLS & AgentTools>;
    tools?: TOOLS;
    model: LanguageModelV1;
  },
> = Omit<T, "toolChoice" | "tools" | "model"> & {
  model?: LanguageModelV1;
} & {
  tools?: TOOLS;
  toolChoice?: ToolChoice<{ [key in keyof TOOLS | keyof AgentTools]: unknown }>;
} & ContextOptions &
  StorageOptions;

type ObjectArgs<
  T extends {
    model: LanguageModelV1;
  },
> = Omit<T, "model"> & {
  model?: LanguageModelV1;
} & ContextOptions &
  StorageOptions;

interface Chat<AgentTools extends ToolSet> {
  generateText<TOOLS extends ToolSet, OUTPUT = never, OUTPUT_PARTIAL = never>(
    args: TextArgs<
      AgentTools,
      TOOLS,
      Parameters<typeof generateText<TOOLS, OUTPUT, OUTPUT_PARTIAL>>[0]
    >
  ): Promise<
    GenerateTextResult<TOOLS & AgentTools, OUTPUT> & GenerationOutputMetadata
  >;

  streamText<TOOLS extends ToolSet, OUTPUT = never, PARTIAL_OUTPUT = never>(
    args: TextArgs<
      AgentTools,
      TOOLS,
      Parameters<typeof streamText<TOOLS, OUTPUT, PARTIAL_OUTPUT>>[0]
    >
  ): Promise<
    StreamTextResult<TOOLS & AgentTools, PARTIAL_OUTPUT> &
      GenerationOutputMetadata
  >;
  // TODO: add all the overloads
  generateObject<T>(
    args: ObjectArgs<Parameters<typeof generateObject>[0]>
  ): Promise<GenerateObjectResult<T> & GenerationOutputMetadata>;
  streamObject<T>(
    args: ObjectArgs<Parameters<typeof streamObject<T>>[0]>
  ): Promise<
    StreamObjectResult<DeepPartial<T>, T, never> & GenerationOutputMetadata
  >;
}

// type ToolParameters = ZodTypeAny | Schema<unknown>; // TODO: support convex validator
// type inferParameters<PARAMETERS extends ToolParameters> =
//   PARAMETERS extends Schema<unknown>
//     ? PARAMETERS["_type"]
//     : PARAMETERS extends z.ZodTypeAny
//       ? z.infer<PARAMETERS>
//       : never;
/**
 * This is a wrapper around the ai.tool function that adds support for
 * userId and chatId to the tool, if they're called within a chat from an agent.
 * @param tool The AI tool. See https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling
 * @returns The same tool, but with userId and chatId args support added.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tool<V extends Validator<any, any, any>, RESULT>(convexTool: {
  args: V;
  description?: string;
  handler: (
    ctx: GenericActionCtx<GenericDataModel> & {
      userId?: string;
      chatId?: string;
    },
    args: Infer<V>,
    options: ToolExecutionOptions
  ) => PromiseLike<RESULT>;
  ctx?: GenericActionCtx<GenericDataModel> & {
    userId?: string;
    chatId?: string;
  };
}): Tool<ConvexToZod<V>, RESULT> {
  const tool = {
    __acceptUserIdAndChatId: true,
    description: convexTool.description,
    parameters: convexToZod(convexTool.args),
    execute: async (args: Infer<V>, options: ToolExecutionOptions) => {
      if (!convexTool.ctx) {
        throw new Error(
          "To use a Convex tool, you must either provide the ctx" +
            " at definition time (dynamically in an action), or use the Agent to" +
            " call it (which injects the ctx, userId and chatId)"
        );
      }
      return convexTool.handler(convexTool.ctx, args, options);
    },
  };
  return tool;
}

export function wrapTools(
  actionCtx: RunActionCtx,
  chatId: string,
  userId?: string,
  ...toolSets: (ToolSet | undefined)[]
): ToolSet {
  const ctx = { ...actionCtx, chatId, userId };
  const output = {} as ToolSet;
  for (const toolSet of toolSets) {
    if (!toolSet) {
      continue;
    }
    for (const [name, tool] of Object.entries(toolSet)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(tool as any).__acceptUserIdAndChatId) {
        output[name] = tool;
      } else {
        const out = { ...tool, ctx };
        output[name] = out;
      }
    }
  }
  return output;
}
// export function convexValidatorSchema<T>(validator: Validator<unknown>)  {
//   return ai.jsonSchema(convexToJsonSchema(validator));
// }
