// See the docs at https://docs.convex.dev/agents/files
import { createThread, saveMessage } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import OpenAI from "openai";
import { getAuthUserId } from "../utils";

/**
 * Generating images
 */

// Generate an image and save it in an assistant message
// This differs in that it's saving the file implicitly by passing the bytes in.
// It will save the file and make a fileId automatically when the input file
// is too big (>100k).
export const replyWithImage = internalAction({
  args: {
    prompt: v.string(),
  },
  handler: async (ctx, { prompt }) => {
    const userId = await getAuthUserId(ctx);
    const threadId = await createThread(ctx, components.agent, {
      userId,
      title: "Image for: " + prompt,
    });
    // Save the user message
    await saveMessage(ctx, components.agent, { threadId, prompt });

    // Generate the image
    const provider = "openai";
    const model = "dall-e-2";
    const imgResponse = await new OpenAI().images.generate({
      model,
      prompt,
      size: "256x256",
      response_format: "url",
    });
    const url = imgResponse.data?.[0].url;
    if (!url) {
      throw new Error(
        "No image URL found. Response: " + JSON.stringify(imgResponse),
      );
    }
    console.debug("short-lived url:", url);
    const image = await fetch(url);
    if (!image.ok) {
      throw new Error("Failed to fetch image. " + JSON.stringify(image));
    }
    const mediaType = image.headers.get("content-type")!;
    if (!mediaType) {
      throw new Error(
        "No MIME type found. Response: " + JSON.stringify(image.headers),
      );
    }

    // // Save the image in an assistant message
    const { message } = await saveMessage(ctx, components.agent, {
      threadId,
      message: {
        role: "assistant",
        content: [
          {
            type: "file",
            // NOTE: passing in the bytes directly!
            // It will be saved automatically in file storage.
            data: await image.arrayBuffer(),
            mediaType: image.headers.get("content-type")!,
          },
        ],
      },
      metadata: {
        text: imgResponse.data?.[0].revised_prompt || undefined,
        model,
        provider,
      },
    });
    return { threadId, assistantMessage: message };
  },
});
