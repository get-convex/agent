import type { UIMessageChunk, ToolSet } from "ai";

export function serializeTextStreamingPartsV5(
  parts: UIMessageChunk<ToolSet>[],
): UIMessageChunk<ToolSet>[] {
  const compressed: UIMessageChunk<ToolSet>[] = [];
  for (const part of parts) {
    const last = compressed.at(-1);
    if (part.type === "text-delta" && last?.type === "text-delta") {
      last.delta += part.delta;
    } else if (
      part.type === "reasoning-delta" &&
      last?.type === "reasoning-delta"
    ) {
      last.delta += part.delta;
    } else {
      if (
        part.type === "start-step" ||
        part.type === "finish-step" ||
        part.type === "start" ||
        part.type === "finish"
      ) {
        continue;
      }
      if (part.type === "file") {
        compressed.push({
          type: "file",
          mediaType: part.mediaType,
          url: part.url,
        });
      }
      compressed.push(part);
    }
  }
  return compressed;
}
