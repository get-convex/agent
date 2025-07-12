import type {
  CoreMessage,
  DeepPartial,
  generateObject,
  GenerateObjectResult,
  generateText,
  GenerateTextResult,
  JSONValue,
  LanguageModelRequestMetadata,
  LanguageModelResponseMetadata,
  LanguageModelV1,
  RepairTextFunction,
  streamObject,
  StreamObjectResult,
  streamText,
  StreamTextResult,
  TelemetrySettings,
  ToolChoice,
  ToolSet,
} from "ai";
import type {
  Auth,
  Expand,
  FunctionReference,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  StorageActionWriter,
  StorageReader,
  WithoutSystemFields,
} from "convex/server";
import type { GenericId } from "convex/values";
import type { Schema } from "zod";
import type { Mounts } from "../component/_generated/api.js";
import type { ThreadDoc } from "../component/schema.js";
import type {
  CallSettings,
  ProviderMetadata,
  ProviderOptions,
  StreamDelta,
  StreamMessage,
  Usage,
} from "../validators.js";
import type { StreamingOptions } from "./streaming.js";

/**
 * Options to configure what messages are fetched as context,
 * automatically with thread.generateText, or directly via search.
 */
export type ContextOptions = {
  /**
   * Whether to include tool messages in the context.
   * By default, tool calls and results are not included.
   */
  excludeToolMessages?: boolean;
  /**
   * How many recent messages to include. These are added after the search
   * messages, and do not count against the search limit.
   * Default: 100
   */
  recentMessages?: number;
  /**
   * Options for searching messages.
   */
  searchOptions?: {
    /**
     * The maximum number of messages to fetch. Default is 10.
     */
    limit: number;
    /**
     * Whether to use text search to find messages. Default is false.
     */
    textSearch?: boolean;
    /**
     * Whether to use vector search to find messages. Default is false.
     * At least one of textSearch or vectorSearch must be true.
     */
    vectorSearch?: boolean;
    /**
     * The score threshold for vector search. Default is 0.0.
     */
    vectorScoreThreshold?: number;
    /**
     * What messages around the search results to include.
     * Default: { before: 2, after: 1 }
     * (two before, and one after each message found in the search)
     * Note, this is after the limit is applied.
     * By default this will quadruple the number of messages fetched.
     */
    messageRange?: { before: number; after: number };
  };
  /**
   * Whether to search across other threads for relevant messages.
   * By default, only the current thread is searched.
   */
  searchOtherThreads?: boolean;
};

/**
 * Options to configure the automatic saving of messages
 * when generating text / objects in a thread.
 */
export type StorageOptions = {
  /**
   * Whether to save messages to the thread history.
   * Pass "all" to save all input and output messages.
   * Pass "none" to not save any input or output messages.
   * Pass "promptAndOutput" to save the prompt and all output messages.
   * If you pass {messages} but no {prompt}, it will assume messages.at(-1) is
   * the prompt.
   * Defaults to "promptAndOutput".
   */
  saveMessages?: "all" | "none" | "promptAndOutput";
  /**
   * @deprecated Use saveMessages instead.
   * Defaults to false, allowing you to pass in arbitrary context that will
   * be in addition to automatically fetched content.
   * Pass true to have all input messages saved to the thread history.
   */
  saveAllInputMessages?: boolean;
  /**
   * @deprecated Use saveMessages instead.
   * Defaults to true, saving the prompt, or last message passed to generateText.
   */
  saveAnyInputMessages?: boolean;
  /**
   * @deprecated Use saveMessages instead.
   * Defaults to true. Whether to save messages generated while chatting.
   */
  saveOutputMessages?: boolean;
};

export type GenerationOutputMetadata = { messageId?: string };

export type UsageHandler = (
  ctx: RunActionCtx,
  args: {
    userId: string | undefined;
    threadId: string | undefined;
    agentName: string | undefined;
    usage: Usage;
    // Often has more information, like cached token usage in the case of openai.
    providerMetadata: ProviderMetadata | undefined;
    model: string;
    provider: string;
  }
) => void | Promise<void>;

export type RawRequestResponseHandler = (
  ctx: RunActionCtx,
  args: {
    userId: string | undefined;
    threadId: string | undefined;
    agentName: string | undefined;
    request: LanguageModelRequestMetadata;
    response: LanguageModelResponseMetadata;
  }
) => void | Promise<void>;

export type AgentComponent = UseApi<Mounts>;

export type TextArgs<
  AgentTools extends ToolSet,
  TOOLS extends ToolSet | undefined = undefined,
  OUTPUT = never,
  OUTPUT_PARTIAL = never,
> = Omit<
  Parameters<
    typeof generateText<
      TOOLS extends undefined ? AgentTools : TOOLS,
      OUTPUT,
      OUTPUT_PARTIAL
    >
  >[0],
  "toolChoice" | "tools" | "model"
> & {
  /**
   * If provided, this message will be used as the "prompt" for the LLM call,
   * instead of the prompt or messages.
   * This is useful if you want to first save a user message, then use it as
   * the prompt for the LLM call in another call.
   */
  promptMessageId?: string;
  /**
   * The model to use for the LLM calls. This will override the model specified
   * in the Agent constructor.
   */
  model?: LanguageModelV1;
  /**
   * The tools to use for the tool calls. This will override tools specified
   * in the Agent constructor or createThread / continueThread.
   */
  tools?: TOOLS;
  /**
   * The tool choice to use for the tool calls. This must be one of the tools
   * specified in the tools array. e.g. {toolName: "getWeather", type: "tool"}
   */
  toolChoice?: ToolChoice<TOOLS extends undefined ? AgentTools : TOOLS>;
};

export type StreamingTextArgs<
  AgentTools extends ToolSet,
  TOOLS extends ToolSet | undefined = undefined,
  OUTPUT = never,
  OUTPUT_PARTIAL = never,
> = Omit<
  Parameters<
    typeof streamText<
      TOOLS extends undefined ? AgentTools : TOOLS,
      OUTPUT,
      OUTPUT_PARTIAL
    >
  >[0],
  "toolChoice" | "tools" | "model"
> & {
  /**
   * If provided, this message will be used as the "prompt" for the LLM call,
   * instead of the prompt or messages.
   * This is useful if you want to first save a user message, then use it as
   * the prompt for the LLM call in another call.
   */
  promptMessageId?: string;
  /**
   * The model to use for the tool calls. This will override the model specified
   * in the Agent constructor.
   */
  model?: LanguageModelV1;
  /**
   * The tools to use for the tool calls. This will override tools specified
   * in the Agent constructor or createThread / continueThread.
   */
  tools?: TOOLS;
  /**
   * The tool choice to use for the tool calls. This must be one of the tools
   * specified in the tools array. e.g. {toolName: "getWeather", type: "tool"}
   */
  toolChoice?: ToolChoice<TOOLS extends undefined ? AgentTools : TOOLS>;
};

type BaseGenerateObjectOptions = CallSettings & {
  /**
   * The model to use for the object generation. This will override the model
   * specified in the Agent constructor.
   */
  model?: LanguageModelV1;
  /**
   * The system prompt to use for the object generation. This will override the
   * system prompt specified in the Agent constructor.
   */
  system?: string;
  /**
   * The prompt to the LLM to use for the object generation.
   * Specify this or messages, but not both.
   */
  prompt?: string;
  /**
   * The messages to use for the object generation.
   * Note: recent messages are automatically added based on the thread it's
   * associated with and your contextOptions.
   */
  messages?: CoreMessage[];
  /**
   * The message to use as the "prompt" for the object generation.
   * If this is provided, it will be used instead of the prompt or messages.
   * This is useful if you want to first save a user message, then use it as
   * the prompt for the object generation in another call.
   */
  promptMessageId?: string;
  experimental_repairText?: RepairTextFunction;
  experimental_telemetry?: TelemetrySettings;
  providerOptions?: ProviderOptions;
  experimental_providerMetadata?: ProviderMetadata;
};

type GenerateObjectObjectOptions<T extends Record<string, unknown>> =
  BaseGenerateObjectOptions & {
    output?: "object";
    mode?: "auto" | "json" | "tool";
    schema: Schema<T>;
    schemaName?: string;
    schemaDescription?: string;
  };

type GenerateObjectArrayOptions<T> = BaseGenerateObjectOptions & {
  output: "array";
  mode?: "auto" | "json" | "tool";
  schema: Schema<T>;
  schemaName?: string;
  schemaDescription?: string;
};

type GenerateObjectWithEnumOptions<T extends string> =
  BaseGenerateObjectOptions & {
    output: "enum";
    enum: Array<T>;
    mode?: "auto" | "json" | "tool";
  };

type GenerateObjectNoSchemaOptions = BaseGenerateObjectOptions & {
  schema?: undefined;
  mode?: "json";
};

// TODO: simplify this to just use the generateObject args, with an optional
// model and tool/toolChoice types
type GenerateObjectArgs<T> =
  T extends Record<string, unknown>
    ? GenerateObjectObjectOptions<T>
    : T extends Array<unknown>
      ? GenerateObjectArrayOptions<T>
      : T extends string
        ? GenerateObjectWithEnumOptions<T>
        : GenerateObjectNoSchemaOptions;

type StreamObjectArgs<T> =
  T extends Record<string, unknown>
    ? GenerateObjectObjectOptions<T>
    : T extends Array<unknown>
      ? GenerateObjectArrayOptions<T>
      : GenerateObjectNoSchemaOptions;

export type OurObjectArgs<T> = GenerateObjectArgs<T> &
  Pick<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Parameters<typeof generateObject<any>>[0],
    "experimental_repairText" | "abortSignal"
  >;

export type OurStreamObjectArgs<T> = StreamObjectArgs<T> &
  Pick<
    Parameters<typeof streamObject<T>>[0],
    "onError" | "onFinish" | "abortSignal"
  >;

type ThreadOutputMetadata = GenerationOutputMetadata & {
  messageId: string;
};

/**
 * The interface for a thread returned from {@link createThread} or {@link continueThread}.
 * This is contextual to a thread and/or user.
 */
export interface Thread<DefaultTools extends ToolSet> {
  /**
   * The target threadId, from the startThread or continueThread initializers.
   */
  threadId: string;
  /**
   * Get the metadata for the thread.
   */
  getMetadata: () => Promise<ThreadDoc>;
  /**
   * Update the metadata for the thread.
   */
  updateMetadata: (
    patch: Partial<WithoutSystemFields<ThreadDoc>>
  ) => Promise<ThreadDoc>;
  /**
   * This behaves like {@link generateText} from the "ai" package except that
   * it add context based on the userId and threadId and saves the input and
   * resulting messages to the thread, if specified.
   * Use {@link continueThread} to get a version of this function already scoped
   * to a thread (and optionally userId).
   * @param args The arguments to the generateText function, along with extra controls
   * for the {@link ContextOptions} and {@link StorageOptions}.
   * @returns The result of the generateText function.
   */
  generateText<
    TOOLS extends ToolSet | undefined = undefined,
    OUTPUT = never,
    OUTPUT_PARTIAL = never,
  >(
    args: TextArgs<
      TOOLS extends undefined ? DefaultTools : TOOLS,
      TOOLS,
      OUTPUT,
      OUTPUT_PARTIAL
    >,
    options?: Options
  ): Promise<
    GenerateTextResult<TOOLS extends undefined ? DefaultTools : TOOLS, OUTPUT> &
      ThreadOutputMetadata
  >;

  /**
   * This behaves like {@link streamText} from the "ai" package except that
   * it add context based on the userId and threadId and saves the input and
   * resulting messages to the thread, if specified.
   * Use {@link continueThread} to get a version of this function already scoped
   * to a thread (and optionally userId).
   * @param args The arguments to the streamText function, along with extra controls
   * for the {@link ContextOptions} and {@link StorageOptions}.
   * @returns The result of the streamText function.
   */
  streamText<
    TOOLS extends ToolSet | undefined = undefined,
    OUTPUT = never,
    PARTIAL_OUTPUT = never,
  >(
    args: StreamingTextArgs<
      TOOLS extends undefined ? DefaultTools : TOOLS,
      TOOLS,
      OUTPUT,
      PARTIAL_OUTPUT
    >,
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
      TOOLS extends undefined ? DefaultTools : TOOLS,
      PARTIAL_OUTPUT
    > &
      ThreadOutputMetadata
  >;
  /**
   * This behaves like {@link generateObject} from the "ai" package except that
   * it add context based on the userId and threadId and saves the input and
   * resulting messages to the thread, if specified. This overload is for objects, arrays, and enums.
   * Use {@link continueThread} to get a version of this function already scoped
   * to a thread (and optionally userId).
   * @param args The arguments to the generateObject function, along with extra controls
   * for the {@link ContextOptions} and {@link StorageOptions}.
   * @returns The result of the generateObject function.
   */
  generateObject<T>(
    args: OurObjectArgs<T>,
    options?: Options
  ): Promise<GenerateObjectResult<T> & ThreadOutputMetadata>;
  /**
   * This behaves like {@link generateObject} from the "ai" package except that
   * it add context based on the userId and threadId and saves the input and
   * resulting messages to the thread, if specified. This overload is for when there's no schema.
   * Use {@link continueThread} to get a version of this function already scoped
   * to a thread (and optionally userId).
   * @param args The arguments to the generateObject function, along with extra controls
   * for the {@link ContextOptions} and {@link StorageOptions}.
   * @returns The result of the generateObject function.
   */
  generateObject(
    args: GenerateObjectNoSchemaOptions,
    options?: Options
  ): Promise<GenerateObjectResult<JSONValue> & ThreadOutputMetadata>;
  /**
   * This behaves like {@link streamObject} from the "ai" package except that
   * it add context based on the userId and threadId and saves the input and
   * resulting messages to the thread, if specified.
   * Use {@link continueThread} to get a version of this function already scoped
   * to a thread (and optionally userId).
   * @param args The arguments to the streamObject function, along with extra controls
   * for the {@link ContextOptions} and {@link StorageOptions}.
   * @returns The result of the streamObject function.
   */
  streamObject<T>(
    args: OurStreamObjectArgs<T>,
    options?: Options
  ): Promise<
    StreamObjectResult<DeepPartial<T>, T, never> & ThreadOutputMetadata
  >;
}

export type Options = {
  /**
   * The context options to use for passing in message history to the LLM.
   */
  contextOptions?: ContextOptions;
  /**
   * The storage options to use for saving the input and output messages to the thread.
   */
  storageOptions?: StorageOptions;
};

export type SyncStreamsReturnValue =
  | { kind: "list"; messages: StreamMessage[] }
  | { kind: "deltas"; deltas: StreamDelta[] }
  | undefined;

/* Type utils follow */
export type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
export type RunMutationCtx = {
  runQuery: GenericMutationCtx<GenericDataModel>["runQuery"];
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
export type RunActionCtx = {
  runQuery: GenericActionCtx<GenericDataModel>["runQuery"];
  runMutation: GenericActionCtx<GenericDataModel>["runMutation"];
  runAction: GenericActionCtx<GenericDataModel>["runAction"];
};
export type ActionCtx = RunActionCtx & {
  auth: Auth;
  storage: StorageActionWriter;
};
export type QueryCtx = RunQueryCtx & {
  storage: StorageReader;
};

export type OpaqueIds<T> =
  T extends GenericId<infer _T>
    ? string
    : T extends (infer U)[]
      ? OpaqueIds<U>[]
      : T extends ArrayBuffer
        ? ArrayBuffer
        : T extends object
          ? {
              [K in keyof T]: OpaqueIds<T[K]>;
            }
          : T;

export type UseApi<API> = Expand<{
  [mod in keyof API]: API[mod] extends FunctionReference<
    infer FType,
    "public",
    infer FArgs,
    infer FReturnType,
    infer FComponentPath
  >
    ? FunctionReference<
        FType,
        "internal",
        OpaqueIds<FArgs>,
        OpaqueIds<FReturnType>,
        FComponentPath
      >
    : UseApi<API[mod]>;
}>;
