import { Infer, ObjectType, v, Validator, Value } from "convex/values";
import { vVectorDimension } from "./component/vector/tables";

// const deprecated = v.optional(v.any()) as unknown as VNull<unknown, "optional">;

export const vProviderOptions = v.record(
  v.string(),
  v.record(v.string(), v.any())
);
const providerOptions = v.optional(vProviderOptions);
export type ProviderOptions = Infer<typeof providerOptions>;

export const vProviderMetadata = vProviderOptions;
const providerMetadata = providerOptions;
export type ProviderMetadata = Infer<typeof providerMetadata>;

export const vThreadStatus = v.union(
  v.literal("active"),
  v.literal("archived") // unused
);
export const vMessageStatus = v.union(
  v.literal("pending"),
  v.literal("success"),
  v.literal("failed")
);
export type MessageStatus = Infer<typeof vMessageStatus>;

export const vRole = v.union(
  v.literal("system"),
  v.literal("user"),
  v.literal("assistant"),
  v.literal("tool")
);

export const vTextPart = v.object({
  type: v.literal("text"),
  text: v.string(),
  providerOptions,
});

export const vImagePart = v.object({
  type: v.literal("image"),
  image: v.union(v.string(), v.bytes()),
  mimeType: v.optional(v.string()),
  providerOptions,
});

export const vFilePart = v.object({
  type: v.literal("file"),
  data: v.union(v.string(), v.bytes()),
  mimeType: v.string(),
  providerOptions,
});

export const vFile = v.object({
  data: v.optional(v.union(v.bytes(), v.string())),
  url: v.optional(v.string()),
  mimeType: v.string(),
  fileId: v.optional(v.id("files")),
});

export const vFileWithStringId = v.object({
  ...vFile.fields,
  fileId: v.optional(v.string()),
});

export const vUserContent = v.union(
  v.string(),
  v.array(v.union(vTextPart, vImagePart, vFilePart))
);

export const vReasoningPart = v.object({
  type: v.literal("reasoning"),
  text: v.string(),
  signature: v.optional(v.string()),
  providerOptions,
});

export const vRedactedReasoningPart = v.object({
  type: v.literal("redacted-reasoning"),
  data: v.string(),
  providerOptions,
});

export const vReasoningDetails = v.array(
  v.union(
    v.object({
      type: v.literal("text"),
      text: v.string(),
      signature: v.optional(v.string()),
    }),
    v.object({
      type: v.literal("redacted"),
      data: v.string(),
    })
  )
);

export const vToolCallPart = v.object({
  type: v.literal("tool-call"),
  toolCallId: v.string(),
  toolName: v.string(),
  args: v.any(),
  providerOptions,
});

export const vAssistantContent = v.union(
  v.string(),
  v.array(
    v.union(
      vTextPart,
      vFilePart,
      vReasoningPart,
      vRedactedReasoningPart,
      vToolCallPart
    )
  )
);

const vToolResultContent = v.array(
  v.union(
    v.object({
      type: v.literal("text"),
      text: v.string(),
    }),
    v.object({
      type: v.literal("image"),
      data: v.string(),
      mimeType: v.optional(v.string()),
    })
  )
);

const vToolResultPart = v.object({
  type: v.literal("tool-result"),
  toolCallId: v.string(),
  toolName: v.string(),
  result: v.any(),
  // This is only here b/c steps include it in toolResults
  // Normal CoreMessage doesn't have this
  args: v.optional(v.any()),
  experimental_content: v.optional(vToolResultContent),
  isError: v.optional(v.boolean()),
  providerOptions,
});
export const vToolContent = v.array(vToolResultPart);

export const vContent = v.union(vUserContent, vAssistantContent, vToolContent);
export type Content = Infer<typeof vContent>;

export const vUserMessage = v.object({
  role: v.literal("user"),
  content: vUserContent,
  providerOptions,
});

export const vAssistantMessage = v.object({
  role: v.literal("assistant"),
  content: vAssistantContent,
  providerOptions,
});

export const vToolMessage = v.object({
  role: v.literal("tool"),
  content: vToolContent,
  providerOptions,
});

export const vSystemMessage = v.object({
  role: v.literal("system"),
  content: v.string(),
  providerOptions,
});

export const vMessage = v.union(
  vUserMessage,
  vAssistantMessage,
  vToolMessage,
  vSystemMessage
);
export type Message = Infer<typeof vMessage>;

export const vSource = v.object({
  sourceType: v.literal("url"),
  id: v.string(),
  url: v.string(),
  title: v.optional(v.string()),
  providerOptions,
});

export const vRequest = v.object({
  body: v.optional(v.any()),
  // These are not usually present
  headers: v.optional(v.record(v.string(), v.string())),
  method: v.optional(v.string()),
  url: v.optional(v.string()),
});

const vMessageWithFileAndId = v.object({
  id: v.optional(v.string()),
  message: vMessage,
  fileId: v.optional(v.id("files")),
});

export const vResponse = v.object({
  id: v.string(),
  timestamp: v.number(),
  modelId: v.string(),
  headers: v.optional(v.record(v.string(), v.string())), // clear these?
  messages: v.array(vMessageWithFileAndId),
  body: v.optional(v.any()),
});

export const vResponseWithoutMessages = v.object({
  id: v.string(),
  timestamp: v.number(),
  modelId: v.string(),
  headers: v.optional(v.record(v.string(), v.string())), // clear these?
  body: v.optional(v.any()),
});

export const vFinishReason = v.union(
  v.literal("stop"),
  v.literal("length"),
  v.literal("content-filter"),
  v.literal("tool-calls"),
  v.literal("error"),
  v.literal("other"),
  v.literal("unknown")
);

export const vUsage = v.object({
  promptTokens: v.number(),
  completionTokens: v.number(),
  totalTokens: v.number(),
});
export type Usage = Infer<typeof vUsage>;

export const vLanguageModelV1CallWarning = v.union(
  v.object({
    type: v.literal("unsupported-setting"),
    setting: v.string(),
    details: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("unsupported-tool"),
    tool: v.any(),
    details: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("other"),
    message: v.string(),
  })
);

export const vMessageWithMetadata = v.object({
  id: v.optional(v.string()), // external id, e.g. from Vercel AI SDK
  message: vMessage,
  text: v.optional(v.string()),
  files: v.optional(v.array(vFile)),
  // metadata
  finishReason: v.optional(vFinishReason),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  providerMetadata,
  sources: v.optional(v.array(vSource)),
  reasoning: v.optional(v.string()),
  reasoningDetails: v.optional(vReasoningDetails),
  usage: v.optional(vUsage),
  warnings: v.optional(v.array(vLanguageModelV1CallWarning)),
  error: v.optional(v.string()),
});
export type MessageWithMetadata = Infer<typeof vMessageWithMetadata>;

export const vMessageEmbeddings = v.object({
  model: v.string(),
  dimension: vVectorDimension,
  vectors: v.array(v.union(v.array(v.number()), v.null())),
});

export const vStep = v.object({
  files: v.optional(v.array(v.any())),
  finishReason: vFinishReason,
  isContinued: v.boolean(),
  logprobs: v.optional(v.any()),
  providerMetadata,
  experimental_providerMetadata: providerMetadata,
  reasoning: v.optional(v.string()),
  reasoningDetails: v.optional(vReasoningDetails),
  request: v.optional(vRequest),
  response: v.optional(vResponse),
  sources: v.optional(v.array(vSource)),
  stepType: v.union(
    v.literal("initial"),
    v.literal("continue"),
    v.literal("tool-result")
  ),
  text: v.string(),
  toolCalls: v.array(vToolCallPart),
  toolResults: v.array(vToolResultPart),
  usage: v.optional(vUsage),
  warnings: v.optional(v.array(vLanguageModelV1CallWarning)),
});
export type Step = Infer<typeof vStep>;

export const vStepWithMessages = v.object({
  step: vStep,
  messages: v.array(vMessageWithMetadata),
  embeddings: v.optional(vMessageEmbeddings),
});
export type StepWithMessagesWithMetadata = Infer<typeof vStepWithMessages>;

export const vObjectResult = v.object({
  request: vRequest,
  response: vResponseWithoutMessages,
  finishReason: vFinishReason,
  usage: v.optional(v.any()),
  object: v.any(),
  error: v.optional(v.string()),
  warnings: v.optional(v.array(vLanguageModelV1CallWarning)),
  providerMetadata,
});
export type ObjectResult = Infer<typeof vObjectResult>;
export const vSearchOptions = v.object({
  vector: v.optional(v.array(v.number())),
  vectorModel: v.optional(v.string()),
  text: v.optional(v.string()),
  limit: v.number(),
  vectorScoreThreshold: v.optional(v.number()),
  messageRange: v.optional(v.object({ before: v.number(), after: v.number() })),
});
export type SearchOptions = Infer<typeof vSearchOptions>;

export const vContextOptionsSearchOptions = v.object({
  limit: v.number(),
  textSearch: v.optional(v.boolean()),
  vectorSearch: v.optional(v.boolean()),
  messageRange: v.optional(v.object({ before: v.number(), after: v.number() })),
});

export const vContextOptions = v.object({
  excludeToolMessages: v.optional(v.boolean()),
  recentMessages: v.optional(v.number()),
  searchOptions: v.optional(vContextOptionsSearchOptions),
  searchOtherThreads: v.optional(v.boolean()),
});

export const vStorageOptions = v.object({
  saveAllInputMessages: v.optional(v.boolean()),
  saveAnyInputMessages: v.optional(v.boolean()),
  saveOutputMessages: v.optional(v.boolean()),
});

const vPromptFields = {
  system: v.optional(v.string()),
  prompt: v.optional(v.string()),
  messages: v.optional(v.array(vMessage)),
  promptMessageId: v.optional(v.string()),
};

export const vCallSettingsFields = {
  maxTokens: v.optional(v.number()),
  temperature: v.optional(v.number()),
  topP: v.optional(v.number()),
  topK: v.optional(v.number()),
  presencePenalty: v.optional(v.number()),
  frequencyPenalty: v.optional(v.number()),
  seed: v.optional(v.number()),
  maxRetries: v.optional(v.number()),
  headers: v.optional(v.record(v.string(), v.string())),
};
export type CallSettings = ObjectType<typeof vCallSettingsFields>;

const vCommonArgs = {
  userId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  contextOptions: v.optional(vContextOptions),
  storageOptions: v.optional(vStorageOptions),
  providerOptions,
  ...vCallSettingsFields,
  ...vPromptFields,
};

export const vTextArgs = v.object({
  ...vCommonArgs,
  stream: v.optional(v.boolean()),
  toolChoice: v.optional(
    v.union(
      v.literal("auto"),
      v.literal("none"),
      v.literal("required"),
      v.object({
        type: v.literal("tool"),
        toolName: v.string(),
      })
    )
  ),
  maxSteps: v.optional(v.number()),
  experimental_continueSteps: v.optional(v.boolean()),
});
export type TextArgs = Infer<typeof vTextArgs>;

export const vSafeObjectArgs = v.object(vCommonArgs);
export type SafeObjectArgs = Infer<typeof vSafeObjectArgs>;

export const vEmbeddingsWithMetadata = v.object({
  vectors: v.array(v.union(v.array(v.number()), v.null())),
  dimension: vVectorDimension,
  model: v.string(),
});
export type EmbeddingsWithMetadata = Infer<typeof vEmbeddingsWithMetadata>;

export function paginationResultValidator<
  T extends Validator<Value, "required", string>,
>(itemValidator: T) {
  return v.object({
    page: v.array(itemValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null()
      )
    ),
  });
}

export const vStreamArgs = v.array(
  v.object({ key: v.string(), cursor: v.number() })
);
