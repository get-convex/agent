import {
  smoothStream,
  type StreamTextTransform,
  type ToolSet,
  type TextStreamPart,
} from "ai";
import {
  DEFAULT_STREAMING_OPTIONS,
  type StreamingOptions,
} from "./streaming.js";

export function serializeTextStreamingPartsV5(
  parts: TextStreamPart<ToolSet>[],
): TextStreamPart<ToolSet>[] {
  const compressed: TextStreamPart<ToolSet>[] = [];
  for (const part of parts) {
    const last = compressed.at(-1);
    if (part.type === "text-delta" && last?.type === "text-delta") {
      last.text += part.text;
    } else if (
      part.type === "reasoning-delta" &&
      last?.type === "reasoning-delta"
    ) {
      last.text += part.text;
    } else {
      if (part.type === "file") {
        compressed.push({
          type: "file",
          file: {
            ...part.file,
            uint8Array: undefined as unknown as Uint8Array,
          },
        });
      }
      compressed.push(part);
    }
  }
  return compressed;
}

export function mergeTransforms<TOOLS extends ToolSet>(
  options: StreamingOptions | boolean | undefined,
  existing:
    | StreamTextTransform<TOOLS>
    | Array<StreamTextTransform<TOOLS>>
    | undefined,
) {
  if (!options) {
    return existing;
  }
  const chunking =
    typeof options === "boolean"
      ? DEFAULT_STREAMING_OPTIONS.chunking
      : options.chunking;
  const transforms = Array.isArray(existing)
    ? existing
    : existing
      ? [existing]
      : [];
  transforms.push(smoothStream({ delayInMs: null, chunking }));
  return transforms;
}
