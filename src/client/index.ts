import type { EmbeddingModelV1, LanguageModelV1 } from "@ai-sdk/provider";
import type {
  CoreMessage,
  DeepPartial,
  FilePart,
  GenerateObjectResult,
  GenerateTextResult,
  ImagePart,
  StepResult,
  StreamObjectResult,
  StreamTextResult,
  ToolSet,
} from "ai";
import { generateObject, generateText, streamObject, streamText } from "ai";
import { assert } from "convex-helpers";
import {
  internalActionGeneric,
  internalMutationGeneric,
  type PaginationOptions,
  type PaginationResult,
  type WithoutSystemFields,
} from "convex/server";
import { v } from "convex/values";
import type { MessageDoc, ThreadDoc } from "../component/schema.js";
import {
  validateVectorDimension,
  type VectorDimension,
} from "../component/vector/tables.js";
import {
  type AIMessageWithoutId,
  deserializeMessage,
  promptOrMessagesToCoreMessages,
  serializeMessage,
  serializeNewMessagesInStep,
  serializeObjectResult,
} from "../mapping.js";
import {
  DEFAULT_MESSAGE_RANGE,
  DEFAULT_RECENT_MESSAGES,
  extractText,
  isTool,
} from "../shared.js";
import {
  type MessageWithMetadata,
  type MessageStatus,
  type ProviderMetadata,
  type SearchOptions,
  type StreamArgs,
  type Usage,
  vMessageWithMetadata,
  vSafeObjectArgs,
  vTextArgs,
} from "../validators.js";
import { createTool, wrapTools } from "./createTool.js";
import {
  DeltaStreamer,
  mergeTransforms,
  type StreamingOptions,
} from "./streaming.js";
import type {
  AgentComponent,
  ContextOptions,
  GenerationOutputMetadata,
  Options,
  OurObjectArgs,
  OurStreamObjectArgs,
  RawRequestResponseHandler,
  RunActionCtx,
  RunMutationCtx,
  RunQueryCtx,
  ActionCtx,
  StorageOptions,
  StreamingTextArgs,
  SyncStreamsReturnValue,
  TextArgs,
  Thread,
  UsageHandler,
} from "./types.js";

export { storeFile, getFile } from "./files.js";
export { serializeDataOrUrl } from "../mapping.js";
export { vMessageDoc, vThreadDoc } from "../component/schema.js";
export {
  vAssistantMessage,
  vContextOptions,
  vMessage,
  vPaginationResult,
  vProviderMetadata,
  vStorageOptions,
  vStreamArgs,
  vSystemMessage,
  vToolMessage,
  vUsage,
  vUserMessage,
} from "../validators.js";
export type { ToolCtx } from "./createTool.js";
export { createTool, extractText, isTool };
export type {
  AgentComponent,
  ContextOptions,
  MessageDoc,
  ProviderMetadata,
  StorageOptions,
  SyncStreamsReturnValue,
  Thread,
  ThreadDoc,
  Usage,
  UsageHandler,
};

export class Agent<AgentTools extends ToolSet> {
  constructor(
    public component: AgentComponent,
    public options: {
      /**
       * The name for the agent. This will be attributed on each message
       * created by this agent.
       */
      name?: string;
      /**
       * The LLM model to use for generating / streaming text and objects.
       * e.g.
       * import { openai } from "@ai-sdk/openai"
       * const myAgent = new Agent(components.agent, {
       *   chat: openai.chat("gpt-4o-mini"),
       */
      chat: LanguageModelV1;
      /**
       * The model to use for text embeddings. Optional.
       * If specified, it will use this for generating vector embeddings
       * of chats, and can opt-in to doing vector search for automatic context
       * on generateText, etc.
       * e.g.
       * import { openai } from "@ai-sdk/openai"
       * const myAgent = new Agent(components.agent, {
       *   textEmbedding: openai.embedding("text-embedding-3-small")
       */
      textEmbedding?: EmbeddingModelV1<string>;
      /**
       * The default system prompt to put in each request.
       * Override per-prompt by passing the "system" parameter.
       */
      instructions?: string;
      /**
       * Tools that the agent can call out to and get responses from.
       * They can be AI SDK tools (import {tool} from "ai")
       * or tools that have Convex context
       * (import { createTool } from "@convex-dev/agent")
       */
      tools?: AgentTools;
      /**
       * Options to determine what messages are included as context in message
       * generation. To disable any messages automatically being added, pass:
       * { recentMessages: 0 }
       */
      contextOptions?: ContextOptions;
      /**
       * Determines whether messages are automatically stored when passed as
       * arguments or generated.
       */
      storageOptions?: StorageOptions;
      /**
       * When generating or streaming text with tools available, this
       * determines the default max number of iterations.
       */
      maxSteps?: number;
      /**
       * The maximum number of calls to make to an LLM in case it fails.
       * This can be overridden at each generate/stream callsite.
       */
      maxRetries?: number;
      /**
       * The usage handler to use for this agent.
       */
      usageHandler?: UsageHandler;
      /**
       * Called for each LLM request/response, so you can do things like
       * log the raw request body or response headers to a table, or logs.
       */
      rawRequestResponseHandler?: RawRequestResponseHandler;
    }
  ) {}

  /**
   * Start a new thread with the agent. This will have a fresh history, though if
   * you pass in a userId you can have it search across other threads for relevant
   * messages as context for the LLM calls.
   * @param ctx The context of the Convex function. From an action, you can thread
   *   with the agent. From a mutation, you can start a thread and save the threadId
   *   to pass to continueThread later.
   * @param args The thread metadata.
   * @returns The threadId of the new thread and the thread object.
   */
  async createThread<ThreadTools extends ToolSet | undefined = undefined>(
    ctx: RunActionCtx,
    args?: {
      /**
       * The userId to associate with the thread. If not provided, the thread will be
       * anonymous.
       */
      userId?: string;
      /**
       * The title of the thread. Not currently used for anything.
       */
      title?: string;
      /**
       * The summary of the thread. Not currently used for anything.
       */
      summary?: string;
      /**
       * The usage handler to use for this thread. Overrides any handler
       * set in the agent constructor.
       */
      usageHandler?: UsageHandler;
      /**
       * The tools to use for this thread.
       * Overrides any tools passed in the agent constructor.
       */
      tools?: ThreadTools;
    }
  ): Promise<{
    threadId: string;
    thread: Thread<ThreadTools extends undefined ? AgentTools : ThreadTools>;
  }>;
  /**
   * Start a new thread with the agent. This will have a fresh history, though if
   * you pass in a userId you can have it search across other threads for relevant
   * messages as context for the LLM calls.
   * @param ctx The context of the Convex function. From a mutation, you can
   * start a thread and save the threadId to pass to continueThread later.
   * @param args The thread metadata.
   * @returns The threadId of the new thread.
   */
  async createThread<ThreadTools extends ToolSet | undefined = undefined>(
    ctx: RunMutationCtx,
    args?: {
      /**
       * The userId to associate with the thread. If not provided, the thread will be
       * anonymous.
       */
      userId?: string;
      /**
       * The title of the thread. Not currently used for anything.
       */
      title?: string;
      /**
       * The summary of the thread. Not currently used for anything.
       */
      summary?: string;
      /**
       * The usage handler to use for this thread. Overrides any handler
       * set in the agent constructor.
       */
      usageHandler?: UsageHandler;
      /**
       * The tools to use for this thread.
       * Overrides any tools passed in the agent constructor.
       */
      tools?: ThreadTools;
    }
  ): Promise<{
    threadId: string;
  }>;
  async createThread<ThreadTools extends ToolSet | undefined = undefined>(
    ctx: ActionCtx | RunMutationCtx,
    args?: {
      userId: string;
      title?: string;
      summary?: string;
      usageHandler?: UsageHandler;
      tools?: ThreadTools;
    }
  ): Promise<{
    threadId: string;
    thread?: Thread<ThreadTools extends undefined ? AgentTools : ThreadTools>;
  }> {
    const threadDoc = await ctx.runMutation(
      this.component.threads.createThread,
      {
        userId: args?.userId,
        title: args?.title,
        summary: args?.summary,
      }
    );
    if (!("runAction" in ctx)) {
      return { threadId: threadDoc._id };
    }
    const { thread } = await this.continueThread(ctx, {
      threadId: threadDoc._id,
      userId: args?.userId,
      usageHandler: args?.usageHandler,
      tools: args?.tools,
    });
    return {
      threadId: threadDoc._id,
      thread,
    };
  }

  /**
   * Continues a thread using this agent. Note: threads can be continued
   * by different agents. This is a convenience around calling the various
   * generate and stream functions with explicit userId and threadId parameters.
   * @param ctx The ctx object passed to the action handler
   * @param { threadId, userId }: the thread and user to associate the messages with.
   * @returns Functions bound to the userId and threadId on a `{thread}` object.
   */
  async continueThread<ThreadTools extends ToolSet | undefined = undefined>(
    ctx: ActionCtx,
    args: {
      /**
       * The associated thread created by {@link createThread}
       */
      threadId: string;
      /**
       * If supplied, the userId can be used to search across other threads for
       * relevant messages from the same user as context for the LLM calls.
       */
      userId?: string;
      /**
       * The usage handler to use for this thread. Overrides any handler
       * set in the agent constructor.
       */
      usageHandler?: UsageHandler;
      /**
       * The tools to use for this thread.
       * Overrides any tools passed in the agent constructor.
       */
      tools?: ThreadTools;
    }
  ): Promise<{
    thread: Thread<ThreadTools extends undefined ? AgentTools : ThreadTools>;
  }> {
    return {
      thread: {
        threadId: args.threadId,
        getMetadata: this.getThreadMetadata.bind(this, ctx, {
          threadId: args.threadId,
        }),
        updateMetadata: (patch: Partial<WithoutSystemFields<ThreadDoc>>) =>
          ctx.runMutation(this.component.threads.updateThread, {
            threadId: args.threadId,
            patch,
          }),
        generateText: this.generateText.bind(this, ctx, args),
        streamText: this.streamText.bind(this, ctx, args),
        generateObject: this.generateObject.bind(this, ctx, args),
        streamObject: this.streamObject.bind(this, ctx, args),
      } as Thread<ThreadTools extends undefined ? AgentTools : ThreadTools>,
    };
  }

  /**
   * This behaves like {@link generateText} from the "ai" package except that
   * it add context based on the userId and threadId and saves the input and
   * resulting messages to the thread, if specified.
   * Use {@link continueThread} to get a version of this function already scoped
   * to a thread (and optionally userId).
   * @param ctx The context passed from the action function calling this.
   * @param { userId, threadId }: The user and thread to associate the message with
   * @param args The arguments to the generateText function, along with extra controls
   * for the {@link ContextOptions} and {@link StorageOptions}.
   * @returns The result of the generateText function.
   */
  async generateText<
    TOOLS extends ToolSet | undefined = undefined,
    OUTPUT = never,
    OUTPUT_PARTIAL = never,
  >(
    ctx: ActionCtx,
    {
      userId: argsUserId,
      threadId,
      usageHandler,
      tools: threadTools,
    }: {
      userId?: string;
      threadId?: string;
      /**
       * The usage handler to use for this thread. Overrides any handler
       * set in the agent constructor.
       */
      usageHandler?: UsageHandler;
      /** @deprecated Pass `tools` in the next parameter instead. This is only intended to pass through thread-default tools.  */
      tools?: ToolSet;
    },
    args: TextArgs<AgentTools, TOOLS, OUTPUT, OUTPUT_PARTIAL>,
    options?: Options
  ): Promise<
    GenerateTextResult<TOOLS extends undefined ? AgentTools : TOOLS, OUTPUT> &
      GenerationOutputMetadata
  > {
    const context = await this._saveMessagesAndFetchContext(ctx, args, {
      userId: argsUserId,
      threadId,
      ...options,
    });
    const { args: aiArgs, messageId, userId } = context;
    const toolCtx = { ...ctx, userId, threadId, messageId, agent: this };
    const tools = wrapTools(
      toolCtx,
      args.tools ?? threadTools ?? this.options.tools
    ) as TOOLS extends undefined ? AgentTools : TOOLS;
    const saveOutputMessages = this._shouldSaveOutputMessages(
      options?.storageOptions
    );
    const trackUsage = usageHandler ?? this.options.usageHandler;
    try {
      const result = (await generateText({
        // Can be overridden
        maxSteps: this.options.maxSteps,
        ...aiArgs,
        tools,
        onStepFinish: async (step) => {
          if (threadId && messageId && saveOutputMessages) {
            await this.saveStep(ctx, {
              userId,
              threadId,
              promptMessageId: messageId,
              step,
            });
          }
          if (this.options.rawRequestResponseHandler) {
            await this.options.rawRequestResponseHandler(ctx, {
              userId,
              threadId,
              agentName: this.options.name,
              request: step.request,
              response: step.response,
            });
          }
          if (trackUsage && step.usage) {
            await trackUsage(ctx, {
              userId,
              threadId,
              agentName: this.options.name,
              model: aiArgs.model.modelId,
              provider: aiArgs.model.provider,
              usage: step.usage,
              providerMetadata: step.providerMetadata,
            });
          }
          return args.onStepFinish?.(step);
        },
      })) as GenerateTextResult<
        TOOLS extends undefined ? AgentTools : TOOLS,
        OUTPUT
      > &
        GenerationOutputMetadata;
      result.messageId = messageId;
      return result;
    } catch (error) {
      if (threadId && messageId) {
        console.error("RollbackMessage", messageId);
        await ctx.runMutation(this.component.messages.rollbackMessage, {
          messageId,
          error: (error as Error).message,
        });
      }
      throw error;
    }
  }

  /**
   * This behaves like {@link streamText} from the "ai" package except that
   * it add context based on the userId and threadId and saves the input and
   * resulting messages to the thread, if specified.
   * Use {@link continueThread} to get a version of this function already scoped
   * to a thread (and optionally userId).
   */
  async streamText<
    TOOLS extends ToolSet | undefined = undefined,
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
  >(
    ctx: ActionCtx,
    {
      userId: argsUserId,
      threadId,
      usageHandler,
      /**
       * @deprecated Pass `tools` in the next parameter instead.
       * This is only intended to pass through thread-default tools.
       */
      tools: threadTools,
    }: {
      userId?: string;
      threadId?: string;
      usageHandler?: UsageHandler;
      tools?: ToolSet;
    },
    /**
     * The arguments to the streamText function, similar to the ai `streamText` function.
     */
    args: StreamingTextArgs<AgentTools, TOOLS, OUTPUT, PARTIAL_OUTPUT>,
    /**
     * The {@link ContextOptions} and {@link StorageOptions}
     * options to use for fetching contextual messages and saving input/output messages.
     */
    options?: Options & {
      /**
       * Whether to save incremental data (deltas) from streaming responses.
       * Defaults to false.
       * If false, it will not save any deltas to the database.
       * If true, it will save deltas with {@link DEFAULT_STREAMING_OPTIONS}.
       *
       * Regardless of this option, when streaming you are able to use this
       * `streamText` function as you would with the "ai" package's version:
       * iterating over the text, streaming it over HTTP, etc.
       */
      saveStreamDeltas?: boolean | StreamingOptions;
    }
  ): Promise<
    StreamTextResult<
      TOOLS extends undefined ? AgentTools : TOOLS,
      PARTIAL_OUTPUT
    > &
      GenerationOutputMetadata
  > {
    const context = await this._saveMessagesAndFetchContext(ctx, args, {
      userId: argsUserId,
      threadId,
      ...options,
    });
    const { args: aiArgs, messageId, order, stepOrder, userId } = context;
    const toolCtx = { ...ctx, userId, threadId, messageId, agent: this };
    const tools = wrapTools(
      toolCtx,
      args.tools ?? threadTools ?? this.options.tools
    ) as TOOLS extends undefined ? AgentTools : TOOLS;
    const saveOutputMessages = this._shouldSaveOutputMessages(
      options?.storageOptions
    );
    const trackUsage = usageHandler ?? this.options.usageHandler;
    const streamer =
      threadId && options?.saveStreamDeltas
        ? new DeltaStreamer(this.component, ctx, options.saveStreamDeltas, {
            threadId,
            userId,
            agentName: this.options.name,
            model: aiArgs.model.modelId,
            provider: aiArgs.model.provider,
            providerOptions: aiArgs.providerOptions,
            order,
            stepOrder,
            abortSignal: aiArgs.abortSignal,
          })
        : undefined;

    const result = streamText({
      // Can be overridden
      maxSteps: this.options.maxSteps,
      ...aiArgs,
      tools,
      abortSignal: streamer?.abortController.signal ?? aiArgs.abortSignal,
      experimental_transform: mergeTransforms(
        options?.saveStreamDeltas,
        args.experimental_transform
      ),
      onChunk: async (event) => {
        await streamer?.addParts([event.chunk]);
        // console.log("onChunk", chunk);
        return args.onChunk?.(event);
      },
      onError: async (error) => {
        console.error("onError", error);
        if (threadId && messageId && saveOutputMessages) {
          await ctx.runMutation(this.component.messages.rollbackMessage, {
            messageId,
            error: (error.error as Error).message,
          });
        }
        return args.onError?.(error);
      },
      onStepFinish: async (step) => {
        // console.log("onStepFinish", step);
        // TODO: compare delta to the output. internally drop the deltas when committing
        if (threadId && messageId) {
          const saved = await this.saveStep(ctx, {
            userId,
            threadId,
            promptMessageId: messageId,
            step,
          });
          // TODO: figure out pending/not
          await streamer?.finish(saved.messages);
        }
        if (this.options.rawRequestResponseHandler) {
          await this.options.rawRequestResponseHandler(ctx, {
            userId,
            threadId,
            agentName: this.options.name,
            request: step.request,
            response: step.response,
          });
        }
        if (trackUsage && step.usage) {
          await trackUsage(ctx, {
            userId,
            threadId,
            agentName: this.options.name,
            model: aiArgs.model.modelId,
            provider: aiArgs.model.provider,
            usage: step.usage,
            providerMetadata: step.providerMetadata,
          });
        }
        return args.onStepFinish?.(step);
      },
    }) as StreamTextResult<
      TOOLS extends undefined ? AgentTools : TOOLS,
      PARTIAL_OUTPUT
    > &
      GenerationOutputMetadata;
    result.messageId = messageId;
    return result;
  }

  /**
   * This behaves like {@link generateObject} from the "ai" package except that
   * it add context based on the userId and threadId and saves the input and
   * resulting messages to the thread, if specified.
   * Use {@link continueThread} to get a version of this function already scoped
   * to a thread (and optionally userId).
   */
  async generateObject<T>(
    ctx: RunActionCtx,
    {
      userId: argsUserId,
      threadId,
      usageHandler,
    }: { userId?: string; threadId?: string; usageHandler?: UsageHandler },
    /**
     * The arguments to the generateObject function, similar to the ai.generateObject function.
     */
    args: OurObjectArgs<T>,
    /**
     * The {@link ContextOptions} and {@link StorageOptions}
     * options to use for fetching contextual messages and saving input/output messages.
     */
    options?: Options
  ): Promise<GenerateObjectResult<T> & GenerationOutputMetadata> {
    const context = await this._saveMessagesAndFetchContext(ctx, args, {
      userId: argsUserId,
      threadId,
      ...options,
    });
    const { args: aiArgs, messageId, userId } = context;
    const trackUsage = usageHandler ?? this.options.usageHandler;
    const saveOutputMessages = this._shouldSaveOutputMessages(
      options?.storageOptions
    );
    try {
      const result = (await generateObject(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        aiArgs as any
      )) as GenerateObjectResult<T> & GenerationOutputMetadata;

      if (threadId && messageId && saveOutputMessages) {
        await this.saveObject(ctx, {
          threadId,
          promptMessageId: messageId,
          result,
          userId,
        });
      }
      result.messageId = messageId;
      if (this.options.rawRequestResponseHandler) {
        await this.options.rawRequestResponseHandler(ctx, {
          userId,
          threadId,
          agentName: this.options.name,
          request: result.request,
          response: result.response,
        });
      }
      if (trackUsage && result.usage) {
        await trackUsage(ctx, {
          userId,
          threadId,
          agentName: this.options.name,
          model: aiArgs.model.modelId,
          provider: aiArgs.model.provider,
          usage: result.usage,
          providerMetadata: result.providerMetadata,
        });
      }
      return result;
    } catch (error) {
      if (threadId && messageId) {
        await ctx.runMutation(this.component.messages.rollbackMessage, {
          messageId,
          error: (error as Error).message,
        });
      }
      throw error;
    }
  }

  /**
   * This behaves like `streamObject` from the "ai" package except that
   * it add context based on the userId and threadId and saves the input and
   * resulting messages to the thread, if specified.
   * Use {@link continueThread} to get a version of this function already scoped
   * to a thread (and optionally userId).
   */
  async streamObject<T>(
    ctx: RunActionCtx,
    {
      userId: argsUserId,
      threadId,
      usageHandler,
    }: { userId?: string; threadId?: string; usageHandler?: UsageHandler },
    /**
     * The arguments to the streamObject function, similar to the ai `streamObject` function.
     */
    args: OurStreamObjectArgs<T>,
    /**
     * The {@link ContextOptions} and {@link StorageOptions}
     * options to use for fetching contextual messages and saving input/output messages.
     */
    options?: Options
  ): Promise<
    StreamObjectResult<DeepPartial<T>, T, never> & GenerationOutputMetadata
  > {
    // TODO: unify all this shared code between all the generate* and stream* functions
    const context = await this._saveMessagesAndFetchContext(ctx, args, {
      userId: argsUserId,
      threadId,
      ...options,
    });
    const { args: aiArgs, messageId, userId } = context;
    const trackUsage = usageHandler ?? this.options.usageHandler;
    const saveOutputMessages = this._shouldSaveOutputMessages(
      options?.storageOptions
    );
    const stream = streamObject<T>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(aiArgs as any),
      onError: async (error) => {
        console.error("onError", error);
        return args.onError?.(error);
      },
      onFinish: async (result) => {
        if (threadId && messageId && saveOutputMessages) {
          await this.saveObject(ctx, {
            userId,
            threadId,
            promptMessageId: messageId,
            result: {
              object: result.object,
              finishReason: "stop",
              usage: result.usage,
              warnings: result.warnings,
              request: await stream.request,
              response: result.response,
              providerMetadata: result.providerMetadata,
              experimental_providerMetadata:
                result.experimental_providerMetadata,
              logprobs: undefined,
              toJsonResponse: stream.toTextStreamResponse,
            },
          });
        }
        if (trackUsage && result.usage) {
          await trackUsage(ctx, {
            userId,
            threadId,
            agentName: this.options.name,
            model: aiArgs.model.modelId,
            provider: aiArgs.model.provider,
            usage: result.usage,
            providerMetadata: result.providerMetadata,
          });
        }
        if (this.options.rawRequestResponseHandler) {
          await this.options.rawRequestResponseHandler(ctx, {
            userId,
            threadId,
            agentName: this.options.name,
            request: await stream.request,
            response: result.response,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return args.onFinish?.(result as any);
      },
    }) as StreamObjectResult<DeepPartial<T>, T, never> &
      GenerationOutputMetadata;
    stream.messageId = messageId;
    return stream;
  }

  /**
   * Save a message to the thread.
   * @param ctx A ctx object from a mutation or action.
   * @param args The message and what to associate it with (user / thread)
   * You can pass extra metadata alongside the message, e.g. associated fileIds.
   * @returns The messageId of the saved message.
   */
  async saveMessage(
    ctx: RunMutationCtx,
    args: {
      threadId: string;
      userId?: string;
      /**
       * Metadata to save with the messages. Each element corresponds to the
       * message at the same index.
       */
      metadata?: Omit<MessageWithMetadata, "message">;
      /**
       * If true, it will not generate embeddings for the message.
       * Useful if you're saving messages in a mutation where you can't run `fetch`.
       * You can generate them asynchronously by using the scheduler to run an
       * action later that calls `agent.generateAndSaveEmbeddings`.
       */
      skipEmbeddings?: boolean;
    } & (
      | {
          prompt?: undefined;
          /**
           * The message to save.
           */
          message: CoreMessage;
        }
      | {
          /*
           * The prompt to save with the message.
           */
          prompt: string;
          message?: undefined;
        }
    )
  ) {
    const { lastMessageId, messages } = await this.saveMessages(ctx, {
      threadId: args.threadId,
      userId: args.userId,
      messages:
        args.prompt !== undefined
          ? [{ role: "user", content: args.prompt }]
          : [args.message],
      metadata: args.metadata ? [args.metadata] : undefined,
      skipEmbeddings: args.skipEmbeddings,
    });
    return { messageId: lastMessageId, message: messages.at(-1)! };
  }

  /**
   * Explicitly save messages associated with the thread (& user if provided)
   * @param ctx The ctx parameter to a mutation or action.
   * @param args The messages and context to save
   * @returns
   */
  async saveMessages(
    ctx: RunMutationCtx | RunActionCtx,
    args: {
      threadId: string;
      userId?: string;
      /**
       * The message that these messages are in response to. They will be
       * the same "order" as this message, at increasing stepOrder(s).
       */
      promptMessageId?: string;
      /**
       * The messages to save.
       */
      messages: CoreMessageMaybeWithId[];
      /**
       * Metadata to save with the messages. Each element corresponds to the
       * message at the same index.
       */
      metadata?: Omit<MessageWithMetadata, "message">[];
      /**
       * If false, it will "commit" the messages immediately.
       * If true, it will mark them as pending until the final step has finished.
       * Defaults to false.
       */
      pending?: boolean;
      /**
       * If true, it will fail any pending steps.
       * Defaults to false.
       */
      failPendingSteps?: boolean;
      /**
       * Skip generating embeddings for the messages. Useful if you're
       * saving messages in a mutation where you can't run `fetch`.
       * You can generate them asynchronously by using the scheduler to run an
       * action later that calls `agent.generateAndSaveEmbeddings`.
       */
      skipEmbeddings?: boolean;
    }
  ): Promise<{
    lastMessageId: string;
    messages: MessageDoc[];
  }> {
    let embeddings:
      | {
          vectors: (number[] | null)[];
          dimension: VectorDimension;
          model: string;
        }
      | undefined;
    if (args.skipEmbeddings || !("runAction" in ctx)) {
      embeddings = undefined;
      if (!args.skipEmbeddings && this.options.textEmbedding) {
        console.warn(
          "You're trying to save messages and generate embeddings, but you're in a mutation. " +
            "Pass `skipEmbeddings: true` to skip generating embeddings in the mutation and skip this warning. " +
            "They will be generated lazily when you generate or stream text / objects. " +
            "You can explicitly generate them asynchronously by using the scheduler to run an action later that calls `agent.generateAndSaveEmbeddings`."
        );
      }
    } else {
      embeddings = await this.generateEmbeddings(
        ctx,
        {
          userId: args.userId,
          threadId: args.threadId,
        },
        args.messages
      );
    }
    const result = await ctx.runMutation(this.component.messages.addMessages, {
      threadId: args.threadId,
      userId: args.userId,
      agentName: this.options.name,
      promptMessageId: args.promptMessageId,
      embeddings,
      messages: await Promise.all(
        args.messages.map(async (m, i) => {
          const { message, fileIds } = await serializeMessage(
            ctx,
            this.component,
            m
          );
          return {
            ...args.metadata?.[i],
            message,
            fileIds,
          } as MessageWithMetadata;
        })
      ),
      failPendingSteps: args.failPendingSteps ?? false,
      pending: args.pending ?? false,
    });
    return {
      lastMessageId: result.messages.at(-1)!._id,
      messages: result.messages,
    };
  }

  /**
   * List messages from a thread.
   * @param ctx A ctx object from a query, mutation, or action.
   * @param args.threadId The thread to list messages from.
   * @param args.paginationOpts Pagination options (e.g. via usePaginatedQuery).
   * @param args.excludeToolMessages Whether to exclude tool messages.
   *   False by default.
   * @param args.statuses What statuses to include. All by default.
   * @returns The MessageDoc's in a format compatible with usePaginatedQuery.
   */
  async listMessages(
    ctx: RunQueryCtx,
    args: {
      threadId: string;
      paginationOpts: PaginationOptions;
      excludeToolMessages?: boolean;
      statuses?: MessageStatus[];
    }
  ): Promise<PaginationResult<MessageDoc>> {
    if (args.paginationOpts.numItems === 0) {
      return {
        page: [],
        isDone: true,
        continueCursor: args.paginationOpts.cursor ?? "",
      };
    }
    return ctx.runQuery(this.component.messages.listMessagesByThreadId, {
      order: "desc",
      ...args,
    });
  }

  /**
   * A function that handles fetching stream deltas, used with the React hooks
   * `useThreadMessages` or `useStreamingThreadMessages`.
   * @param ctx A ctx object from a query, mutation, or action.
   * @param args.threadId The thread to sync streams for.
   * @param args.streamArgs The stream arguments with per-stream cursors.
   * @returns The deltas for each stream from their existing cursor.
   */
  async syncStreams(
    ctx: RunQueryCtx,
    args: {
      threadId: string;
      streamArgs: StreamArgs | undefined;
      // By default, only streaming messages are included.
      includeStatuses?: ("streaming" | "finished" | "aborted")[];
    }
  ): Promise<SyncStreamsReturnValue | undefined> {
    if (!args.streamArgs) return undefined;
    if (args.streamArgs.kind === "list") {
      return {
        kind: "list",
        messages: await ctx.runQuery(this.component.streams.list, {
          threadId: args.threadId,
          startOrder: args.streamArgs.startOrder,
          statuses: args.includeStatuses,
        }),
      };
    } else {
      return {
        kind: "deltas",
        deltas: await ctx.runQuery(this.component.streams.listDeltas, {
          threadId: args.threadId,
          cursors: args.streamArgs.cursors,
        }),
      };
    }
  }

  /**
   * Fetch the context messages for a thread.
   * @param ctx Either a query, mutation, or action ctx.
   *   If it is not an action context, you can't do text or
   *   vector search.
   * @param args The associated thread, user, message
   * @returns
   */
  async fetchContextMessages(
    ctx: RunQueryCtx | RunActionCtx,
    args: {
      userId: string | undefined;
      threadId: string | undefined;
      messages: CoreMessage[];
      /**
       * If provided, it will search for messages up to and including this message.
       * Note: if this is far in the past, text and vector search results may be more
       * limited, as it's post-filtering the results.
       */
      upToAndIncludingMessageId?: string;
      contextOptions: ContextOptions | undefined;
    }
  ): Promise<MessageDoc[]> {
    assert(args.userId || args.threadId, "Specify userId or threadId");
    // Fetch the latest messages from the thread
    let included: Set<string> | undefined;
    const opts = this._mergedContextOptions(args.contextOptions);
    const contextMessages: MessageDoc[] = [];
    if (
      args.threadId &&
      (opts.recentMessages !== 0 || args.upToAndIncludingMessageId)
    ) {
      const { page } = await ctx.runQuery(
        this.component.messages.listMessagesByThreadId,
        {
          threadId: args.threadId,
          excludeToolMessages: opts.excludeToolMessages,
          paginationOpts: {
            numItems: opts.recentMessages ?? DEFAULT_RECENT_MESSAGES,
            cursor: null,
          },
          upToAndIncludingMessageId: args.upToAndIncludingMessageId,
          order: "desc",
          statuses: ["success"],
        }
      );
      included = new Set(page.map((m) => m._id));
      contextMessages.push(
        // Reverse since we fetched in descending order
        ...page.reverse()
      );
    }
    if (opts.searchOptions?.textSearch || opts.searchOptions?.vectorSearch) {
      const targetMessage = contextMessages.find(
        (m) => m._id === args.upToAndIncludingMessageId
      )?.message;
      const messagesToSearch = targetMessage
        ? [targetMessage, ...args.messages]
        : args.messages;
      if (!("runAction" in ctx)) {
        throw new Error("searchUserMessages only works in an action");
      }
      const searchMessages = await ctx.runAction(
        this.component.messages.searchMessages,
        {
          searchAllMessagesForUserId: opts?.searchOtherThreads
            ? args.userId ??
              (args.threadId &&
                (
                  await ctx.runQuery(this.component.threads.getThread, {
                    threadId: args.threadId,
                  })
                )?.userId)
            : undefined,
          threadId: args.threadId,
          beforeMessageId: args.upToAndIncludingMessageId,
          ...(await this._searchOptionsWithEmbeddingAndDefaults(
            ctx,
            { userId: args.userId, threadId: args.threadId },
            opts,
            messagesToSearch
          )),
        }
      );
      // TODO: track what messages we used for context
      contextMessages.unshift(
        ...searchMessages.filter((m) => !included?.has(m._id))
      );
    }
    // Ensure we don't include tool messages without a corresponding tool call
    return filterOutOrphanedToolMessages(
      contextMessages.sort((a, b) =>
        // Sort the raw MessageDocs by order and stepOrder
        a.order === b.order ? a.stepOrder - b.stepOrder : a.order - b.order
      )
    );
  }

  /**
   * Get the metadata for a thread.
   * @param ctx A ctx object from a query, mutation, or action.
   * @param args.threadId The thread to get the metadata for.
   * @returns The metadata for the thread.
   */
  async getThreadMetadata(
    ctx: RunQueryCtx,
    args: { threadId: string }
  ): Promise<ThreadDoc> {
    const thread = await ctx.runQuery(this.component.threads.getThread, {
      threadId: args.threadId,
    });
    if (!thread) {
      throw new Error("Thread not found");
    }
    return thread;
  }

  /**
   * Update the metadata for a thread.
   * @param ctx A ctx object from a mutation or action.
   * @param args.threadId The thread to update the metadata for.
   * @param args.patch The patch to apply to the thread.
   * @returns The updated thread metadata.
   */
  async updateThreadMetadata(
    ctx: RunMutationCtx,
    args: { threadId: string; patch: Partial<WithoutSystemFields<ThreadDoc>> }
  ): Promise<ThreadDoc> {
    const thread = await ctx.runMutation(
      this.component.threads.updateThread,
      args
    );
    return thread;
  }

  /**
   * Get the embeddings for a set of messages.
   * @param messages The messages to get the embeddings for.
   * @returns The embeddings for the messages.
   */
  async generateEmbeddings(
    ctx: RunActionCtx,
    {
      userId,
      threadId,
    }: {
      userId: string | undefined;
      threadId: string | undefined;
    },
    messages: CoreMessage[]
  ) {
    if (!this.options.textEmbedding) {
      return undefined;
    }
    let embeddings:
      | {
          vectors: (number[] | null)[];
          dimension: VectorDimension;
          model: string;
        }
      | undefined;
    const messageTexts = messages.map((m) => !isTool(m) && extractText(m));
    // Find the indexes of the messages that have text.
    const textIndexes = messageTexts
      .map((t, i) => (t ? i : undefined))
      .filter((i) => i !== undefined);
    if (textIndexes.length === 0) {
      return undefined;
    }
    // Then embed those messages.
    const textEmbeddings = await this.doEmbed(ctx, {
      userId,
      threadId,
      values: messageTexts.filter((t): t is string => !!t),
    });
    // TODO: record usage of embeddings
    // Then assemble the embeddings into a single array with nulls for the messages without text.
    const embeddingsOrNull = Array(messages.length).fill(null);
    textIndexes.forEach((i, j) => {
      embeddingsOrNull[i] = textEmbeddings.embeddings[j];
    });
    if (textEmbeddings.embeddings.length > 0) {
      const dimension = textEmbeddings.embeddings[0].length;
      validateVectorDimension(dimension);
      embeddings = {
        vectors: embeddingsOrNull,
        dimension,
        model: this.options.textEmbedding.modelId,
      };
    }
    return embeddings;
  }

  /**
   * Generate embeddings for a set of messages, and save them to the database.
   * It will not generate or save embeddings for messages that already have an
   * embedding.
   * @param ctx The ctx parameter to an action.
   * @param args The messageIds to generate embeddings for.
   */
  async generateAndSaveEmbeddings(
    ctx: RunActionCtx,
    args: {
      messageIds: string[];
    }
  ) {
    const messages = (
      await ctx.runQuery(this.component.messages.getMessagesByIds, {
        messageIds: args.messageIds,
      })
    ).filter((m): m is NonNullable<typeof m> => m !== null);
    if (messages.length !== args.messageIds.length) {
      throw new Error(
        "Some messages were not found: " +
          args.messageIds
            .filter((id) => !messages.some((m) => m?._id === id))
            .join(", ")
      );
    }
    if (messages.some((m) => !m.message)) {
      throw new Error(
        "Some messages don't have a message: " +
          args.messageIds
            .map((id, i) => (!messages[i].message ? id : undefined))
            .filter((id): id is string => id !== undefined)
            .join(", ")
      );
    }
    const messagesMissingEmbeddings = messages.filter((m) => !m.embeddingId);
    if (messagesMissingEmbeddings.length === 0) {
      return;
    }
    const embeddings = await this.generateEmbeddings(
      ctx,
      {
        userId: messagesMissingEmbeddings[0]!.userId,
        threadId: messagesMissingEmbeddings[0]!.threadId,
      },
      messagesMissingEmbeddings.map((m) => m!.message!)
    );
    if (!embeddings) {
      if (!this.options.textEmbedding) {
        throw new Error(
          "No embeddings were generated for the messages. You must pass a textEmbedding model to the agent constructor."
        );
      }
      throw new Error(
        "No embeddings were generated for these messages: " +
          messagesMissingEmbeddings.map((m) => m!._id).join(", ")
      );
    }
    await ctx.runMutation(this.component.vector.index.insertBatch, {
      vectorDimension: embeddings.dimension,
      vectors: messagesMissingEmbeddings
        .map((m, i) => ({
          messageId: m!._id,
          model: embeddings.model,
          table: "messages",
          userId: m.userId,
          threadId: m.threadId,
          vector: embeddings.vectors[i],
        }))
        .filter(
          (v): v is Extract<typeof v, { vector: number[] }> => v.vector !== null
        ),
    });
  }

  /**
   * Explicitly save a "step" created by the AI SDK.
   * @param ctx The ctx argument to a mutation or action.
   * @param args The Step generated by the AI SDK.
   */
  async saveStep<TOOLS extends ToolSet>(
    ctx: ActionCtx,
    args: {
      userId?: string;
      threadId: string;
      /**
       * The message this step is in response to.
       */
      promptMessageId: string;
      /**
       * The step to save, possibly including multiple tool calls.
       */
      step: StepResult<TOOLS>;
      /**
       * The model used to generate the step.
       * Defaults to the chat model for the Agent.
       */
      model?: string;
      /**
       * The provider of the model used to generate the step.
       * Defaults to the chat provider for the Agent.
       */
      provider?: string;
    }
  ): Promise<{ messages: MessageDoc[]; pending?: MessageDoc }> {
    const messages = await serializeNewMessagesInStep(
      ctx,
      this.component,
      args.step,
      {
        provider: args.provider ?? this.options.chat.provider,
        model: args.model ?? this.options.chat.modelId,
      }
    );
    const embeddings = await this.generateEmbeddings(
      ctx,
      { userId: args.userId, threadId: args.threadId },
      messages.map((m) => m.message)
    );
    const saved = await ctx.runMutation(this.component.messages.addMessages, {
      userId: args.userId,
      threadId: args.threadId,
      agentName: this.options.name,
      promptMessageId: args.promptMessageId,
      messages,
      embeddings,
      failPendingSteps: false,
    });
    return saved;
  }

  /**
   * Manually save the result of a generateObject call to the thread.
   * This happens automatically when using {@link generateObject} or {@link streamObject}
   * from the `thread` object created by {@link continueThread} or {@link createThread}.
   * @param ctx The context passed from the mutation or action function calling this.
   * @param args The arguments to the saveObject function.
   */
  async saveObject(
    ctx: RunActionCtx,
    args: {
      userId: string | undefined;
      threadId: string;
      promptMessageId: string;
      result: GenerateObjectResult<unknown>;
      metadata?: Omit<MessageWithMetadata, "message">;
    }
  ): Promise<void> {
    const { messages } = serializeObjectResult(args.result, {
      model: this.options.chat.modelId,
      provider: this.options.chat.provider,
    });
    const embeddings = await this.generateEmbeddings(
      ctx,
      { userId: args.userId, threadId: args.threadId },
      messages.map((m) => m.message)
    );

    await ctx.runMutation(this.component.messages.addMessages, {
      userId: args.userId,
      threadId: args.threadId,
      promptMessageId: args.promptMessageId,
      failPendingSteps: false,
      messages,
      embeddings,
      agentName: this.options.name,
      pending: false,
    });
  }

  /**
   * Commit or rollback a message that was pending.
   * This is done automatically when saving messages by default.
   * If creating pending messages, you can call this when the full "transaction" is done.
   * @param ctx The ctx argument to your mutation or action.
   * @param args What message to save. Generally the parent message sent into
   *   the generateText call.
   */
  async completeMessage(
    ctx: RunMutationCtx,
    args: {
      threadId: string;
      messageId: string;
      result: { kind: "error"; error: string } | { kind: "success" };
    }
  ): Promise<void> {
    const result = args.result;
    if (result.kind === "success") {
      await ctx.runMutation(this.component.messages.commitMessage, {
        messageId: args.messageId,
      });
    } else {
      await ctx.runMutation(this.component.messages.rollbackMessage, {
        messageId: args.messageId,
        error: result.error,
      });
    }
  }

  async _saveMessagesAndFetchContext<
    T extends {
      id?: string;
      prompt?: string;
      messages?: CoreMessage[] | AIMessageWithoutId[];
      system?: string;
      promptMessageId?: string;
      model?: LanguageModelV1;
      maxRetries?: number;
    },
  >(
    ctx: RunActionCtx,
    args: T,
    {
      userId: argsUserId,
      threadId,
      contextOptions,
      storageOptions,
    }: {
      userId: string | undefined;
      threadId: string | undefined;
    } & Options
  ): Promise<{
    args: T & { model: LanguageModelV1 };
    userId: string | undefined;
    messageId: string | undefined;
    order: number | undefined;
    stepOrder: number | undefined;
  }> {
    contextOptions ||= this.options.contextOptions;
    storageOptions ||= this.options.storageOptions;
    // If only a messageId is provided, this will be empty.
    const messages = args.promptMessageId
      ? []
      : promptOrMessagesToCoreMessages(args);
    const userId =
      argsUserId ??
      (threadId &&
        (await ctx.runQuery(this.component.threads.getThread, { threadId }))
          ?.userId);
    assert(
      !args.promptMessageId || !(args.prompt || args.messages),
      "you can't specify a prompt or message if you specify a promptMessageId"
    );
    // If only a messageId is provided, this will add that message to the end.
    const contextMessages = await this.fetchContextMessages(ctx, {
      userId,
      threadId,
      upToAndIncludingMessageId: args.promptMessageId,
      messages,
      contextOptions,
    });
    // Lazily generate embeddings for the prompt message, if it doesn't have
    // embeddings yet. This can happen if the message was saved in a mutation
    // where the LLM is not available.
    if (
      args.promptMessageId &&
      !contextMessages.at(-1)?.embeddingId &&
      this.options.textEmbedding
    ) {
      await this.generateAndSaveEmbeddings(ctx, {
        messageIds: [args.promptMessageId],
      });
    }
    let messageId = args.promptMessageId;
    let order = args.promptMessageId
      ? contextMessages.at(-1)?.order
      : undefined;
    let stepOrder = args.promptMessageId
      ? contextMessages.at(-1)?.stepOrder
      : undefined;
    if (
      threadId &&
      messages.length &&
      storageOptions?.saveMessages !== "none" &&
      storageOptions?.saveAnyInputMessages !== false
    ) {
      const saveAll = storageOptions?.saveMessages === "all";
      const coreMessages = saveAll ? messages : messages.slice(-1);
      const saved = await this.saveMessages(ctx, {
        threadId,
        userId,
        messages: coreMessages,
        metadata: coreMessages.length === 1 ? [{ id: args.id }] : undefined,
        pending: true,
        failPendingSteps: true,
      });
      messageId = saved.lastMessageId;
      order = saved.messages.at(-1)?.order;
      stepOrder = saved.messages.at(-1)?.stepOrder;
    }

    let processedMessages = [
      ...contextMessages.map((m) => deserializeMessage(m.message!)),
      ...messages,
    ];

    // Process messages to inline localhost files (if not, file urls pointing to localhost will be sent to LLM providers)
    if (process.env.CONVEX_CLOUD_URL?.startsWith("http://127.0.0.1")) {
      processedMessages = await this._inlineMessagesFiles(processedMessages);
    }

    const { prompt: _, model, ...rest } = args;
    return {
      args: {
        ...rest,
        maxRetries: args.maxRetries ?? this.options.maxRetries,
        model: model ?? this.options.chat,
        system: args.system ?? this.options.instructions,
        messages: processedMessages,
      } as T & { model: LanguageModelV1 },
      userId,
      messageId,
      order,
      stepOrder,
    };
  }

  _shouldSaveOutputMessages(storageOpts?: StorageOptions): boolean {
    const opts = storageOpts ?? this.options.storageOptions;
    return opts?.saveOutputMessages !== false && opts?.saveMessages !== "none";
  }

  _mergedContextOptions(opts: ContextOptions | undefined): ContextOptions {
    const searchOptions = {
      ...this.options.contextOptions?.searchOptions,
      ...opts?.searchOptions,
    };
    return {
      ...this.options.contextOptions,
      ...opts,
      searchOptions: searchOptions.limit
        ? (searchOptions as SearchOptions)
        : undefined,
    };
  }

  async _searchOptionsWithEmbeddingAndDefaults(
    ctx: RunActionCtx,
    { userId, threadId }: { userId?: string; threadId?: string },
    contextOptions: ContextOptions,
    messages: CoreMessage[]
  ): Promise<SearchOptions> {
    assert(
      contextOptions.searchOptions?.textSearch ||
        contextOptions.searchOptions?.vectorSearch,
      "searchOptions is required"
    );
    assert(messages.length > 0, "Core messages cannot be empty");
    const text = extractText(messages.at(-1)!);
    const search: SearchOptions = {
      limit: contextOptions.searchOptions?.limit ?? 10,
      messageRange: {
        ...DEFAULT_MESSAGE_RANGE,
        ...contextOptions.searchOptions?.messageRange,
      },
      text: extractText(messages.at(-1)!),
    };
    if (
      contextOptions.searchOptions?.vectorSearch &&
      text &&
      this.options.textEmbedding
    ) {
      search.vector = (
        await this.doEmbed(ctx, {
          threadId,
          userId,
          values: [text],
        })
      ).embeddings[0];
      search.vectorModel = this.options.textEmbedding.modelId;
    }
    return search;
  }

  async doEmbed(
    ctx: RunActionCtx,
    options: {
      userId: string | undefined;
      threadId: string | undefined;
      values: string[];
      abortSignal?: AbortSignal;
      headers?: Record<string, string | undefined>;
    }
  ): Promise<{ embeddings: number[][] }> {
    const embedding = this.options.textEmbedding;
    assert(embedding, "textEmbedding is required");
    const result = await embedding.doEmbed({
      values: options.values,
      abortSignal: options.abortSignal,
      headers: options.headers,
    });
    if (this.options.usageHandler && result.usage) {
      await this.options.usageHandler(ctx, {
        userId: options.userId,
        threadId: options.threadId,
        agentName: this.options.name,
        model: embedding.modelId,
        provider: embedding.provider,
        providerMetadata: result.rawResponse
          ? { [embedding.provider]: result.rawResponse }
          : undefined,
        usage: {
          promptTokens: result.usage.tokens,
          completionTokens: 0,
          totalTokens: result.usage.tokens,
        },
      });
    }
    return { embeddings: result.embeddings };
  }

  /**
   * Process messages to inline file and image URLs that point to localhost
   * by converting them to base64. This solves the problem of LLMs not being
   * able to access localhost URLs.
   */
  private async _inlineMessagesFiles(
    messages: CoreMessage[]
  ): Promise<CoreMessage[]> {
    // Process each message to convert localhost URLs to base64
    return Promise.all(
      messages.map(async (message): Promise<CoreMessage> => {
        if (
          message.role !== "user" ||
          typeof message.content === "string" ||
          !Array.isArray(message.content)
        ) {
          return message;
        }

        const processedContent = await Promise.all(
          message.content.map(async (part) => {
            if (part.type === "image" && part.image instanceof URL) {
              if (this._isLocalhostUrl(part.image)) {
                const imageData = await this._downloadFile(part.image);
                return {
                  ...part,
                  image: imageData,
                } as ImagePart;
              }
            }

            // Handle file parts
            if (part.type === "file" && part.data instanceof URL) {
              if (this._isLocalhostUrl(part.data)) {
                const fileData = await this._downloadFile(part.data);
                return {
                  ...part,
                  data: fileData,
                } as FilePart;
              }
            }

            return part;
          })
        );

        return {
          ...message,
          content: processedContent,
        };
      })
    );
  }

  /**
   * Check if a URL points to localhost
   */
  private _isLocalhostUrl(url: URL): boolean {
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "0.0.0.0"
    );
  }

  /**
   * Download a file from a URL
   */
  private async _downloadFile(url: URL): Promise<ArrayBuffer> {
    // Fetch the file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }

    return await response.arrayBuffer();
  }

  /**
   * WORKFLOW UTILITIES
   */

  /**
   * Create a mutation that creates a thread so you can call it from a Workflow.
   * e.g.
   * ```ts
   * // in convex/foo.ts
   * export const createThread = weatherAgent.createThreadMutation();
   *
   * const workflow = new WorkflowManager(components.workflow);
   * export const myWorkflow = workflow.define({
   *   args: {},
   *   handler: async (step) => {
   *     const { threadId } = await step.runMutation(internal.foo.createThread);
   *     // use the threadId to generate text, object, etc.
   *   },
   * });
   * ```
   * @returns A mutation that creates a thread.
   */
  createThreadMutation() {
    return internalMutationGeneric({
      args: {
        userId: v.optional(v.string()),
        title: v.optional(v.string()),
        summary: v.optional(v.string()),
      },
      handler: async (ctx, args): Promise<{ threadId: string }> => {
        const { threadId } = await this.createThread(ctx, args);
        return { threadId };
      },
    });
  }

  /**
   * Create an action out of this agent so you can call it from workflows or other actions
   * without a wrapping function.
   * @param spec Configuration for the agent acting as an action, including
   *   {@link ContextOptions}, {@link StorageOptions}, and maxSteps.
   */
  asTextAction(spec?: {
    /**
     * The maximum number of steps to take in this action.
     * Defaults to the {@link Agent.maxSteps} option.
     */
    maxSteps?: number;
    /**
     * The {@link ContextOptions} to use for fetching contextual messages and
     * saving input/output messages.
     * Defaults to the {@link Agent.contextOptions} option.
     */
    contextOptions?: ContextOptions;
    /**
     * The {@link StorageOptions} to use for saving input/output messages.
     * Defaults to the {@link Agent.storageOptions} option.
     */
    storageOptions?: StorageOptions;
    /**
     * Whether to stream the text.
     * If false, it will generate the text in a single call. (default)
     * If true or {@link StreamingOptions}, it will stream the text from the LLM
     * and save the chunks to the database with the options you specify, or the
     * defaults if you pass true.
     */
    stream?: boolean | StreamingOptions;
  }) {
    const maxSteps = spec?.maxSteps ?? this.options.maxSteps;
    return internalActionGeneric({
      args: vTextArgs,
      handler: async (ctx, args) => {
        const { contextOptions, storageOptions, ...rest } = args;
        const stream =
          args.stream === true ? spec?.stream || true : spec?.stream ?? false;
        const targetArgs = { userId: args.userId, threadId: args.threadId };
        const llmArgs = { maxSteps, ...rest };
        const opts = {
          contextOptions:
            contextOptions ??
            spec?.contextOptions ??
            this.options.contextOptions,
          storageOptions:
            storageOptions ??
            spec?.storageOptions ??
            this.options.storageOptions,
          saveStreamDeltas: stream,
        };
        if (stream) {
          const result = await this.streamText(ctx, targetArgs, llmArgs, opts);
          await result.consumeStream();
          return {
            text: await result.text,
            finishReason: await result.finishReason,
            messageId: result.messageId,
          };
        } else {
          const { text, messageId, finishReason } = await this.generateText(
            ctx,
            targetArgs,
            llmArgs,
            opts
          );
          return { text, messageId, finishReason };
        }
      },
    });
  }
  /**
   * Create an action that generates an object out of this agent so you can call
   * it from workflows or other actions without a wrapping function.
   * @param spec Configuration for the agent acting as an action, including
   * the normal parameters to {@link generateObject}, plus {@link ContextOptions}
   * and maxSteps.
   */
  asObjectAction<T>(
    spec: OurObjectArgs<T> & { maxSteps?: number },
    options?: {
      contextOptions?: ContextOptions;
      storageOptions?: StorageOptions;
    }
  ) {
    const maxSteps = spec?.maxSteps ?? this.options.maxSteps;
    return internalActionGeneric({
      args: vSafeObjectArgs,
      handler: async (ctx, args) => {
        const { contextOptions, storageOptions, ...rest } = args;
        const value = await this.generateObject(
          ctx,
          { userId: args.userId, threadId: args.threadId },
          {
            ...spec,
            maxSteps,
            ...rest,
          } as unknown as OurObjectArgs<unknown>,
          {
            contextOptions:
              contextOptions ??
              options?.contextOptions ??
              this.options.contextOptions,
            storageOptions:
              storageOptions ??
              options?.storageOptions ??
              this.options.storageOptions,
          }
        );
        return { object: value.object as T };
      },
    });
  }

  /**
   * Save messages to the thread.
   * Useful as a step in Workflows, e.g.
   * ```ts
   * const saveMessages = agent.asSaveMessagesMutation();
   *
   * const myWorkflow = workflow.define({
   *   args: {...},
   *   handler: async (step, args) => {
   *     // do things to create (but not save)messages
   *     const { messageIds } = await step.runMutation(internal.foo.saveMessages, {
   *       threadId: args.threadId,
   *       messages: args.messages,
   *     });
   *     // ...
   *   },
   * })
   * ```
   * @returns A mutation that can be used to save messages to the thread.
   */
  asSaveMessagesMutation() {
    return internalMutationGeneric({
      args: {
        threadId: v.string(),
        userId: v.optional(v.string()),
        promptMessageId: v.optional(v.string()),
        messages: v.array(vMessageWithMetadata),
        pending: v.optional(v.boolean()),
        failPendingSteps: v.optional(v.boolean()),
      },
      handler: async (ctx, args) => {
        const { lastMessageId, messages } = await this.saveMessages(ctx, {
          ...args,
          messages: args.messages.map((m) => m.message),
          metadata: args.messages.map(({ message: _, ...m }) => m),
        });
        return {
          lastMessageId,
          messageIds: messages.map((m) => m._id),
        };
      },
    });
  }
}

export function filterOutOrphanedToolMessages(docs: MessageDoc[]) {
  const toolCallIds = new Set<string>();
  const result: MessageDoc[] = [];
  for (const doc of docs) {
    if (
      doc.message?.role === "assistant" &&
      Array.isArray(doc.message.content)
    ) {
      for (const content of doc.message.content) {
        if (content.type === "tool-call") {
          toolCallIds.add(content.toolCallId);
        }
      }
      result.push(doc);
    } else if (doc.message?.role === "tool") {
      if (doc.message.content.every((c) => toolCallIds.has(c.toolCallId))) {
        result.push(doc);
      } else {
        console.debug("Filtering out orphaned tool message", doc);
      }
    } else {
      result.push(doc);
    }
  }
  return result;
}

type CoreMessageMaybeWithId = CoreMessage & { id?: string | undefined };
