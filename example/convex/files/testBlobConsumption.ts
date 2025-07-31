// "use node";
import { api } from "../_generated/api";
import { action, httpAction, mutation, query } from "../_generated/server";
import { convexToJson, v } from "convex/values";

export const testDirectBlobConsumption = action({
  args: {
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const blob = new Blob([args.content], { type: "text/plain" });

    console.log("=== Testing Direct Blob Consumption ===");
    console.log("Original blob size:", blob.size);

    const buffer = await blob.arrayBuffer();
    console.log("ArrayBuffer size after consumption:", buffer.byteLength);
    console.log("Blob size after arrayBuffer() call:", blob.size);

    const storageId = await ctx.storage.store(blob);
    const metadata = await ctx.storage.getMetadata(storageId);

    console.log("Stored file metadata:", metadata);

    return {
      originalBlobSize: blob.size,
      arrayBufferSize: buffer.byteLength,
      storedFileSize: metadata?.size || 0,
      isZeroByteFile: (metadata?.size || 0) === 0,
      storageId,
    };
  },
});

export const testControlBlob = action({
  args: {
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const blob = new Blob([args.content], { type: "text/plain" });

    console.log("=== Testing Control Blob (No Consumption) ===");
    console.log("Original blob size:", blob.size);

    const storageId = await ctx.storage.store(blob);
    const metadata = await ctx.storage.getMetadata(storageId);

    console.log("Stored file metadata:", metadata);

    return {
      originalBlobSize: blob.size,
      storedFileSize: metadata?.size || 0,
      isZeroByteFile: (metadata?.size || 0) === 0,
      storageId,
    };
  },
});

export const calculateSHA256 = action({
  args: { content: v.string() },
  handler: async (ctx, args) => {
    const blob = new Blob([args.content], { type: "text/plain" });
    const buffer = await blob.arrayBuffer();
    const hashArray = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    );
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  },
});

// export const printBytes = query({
//   args: {},
//   handler: async (ctx, args) => {
//     const blob = new Blob(["Hello, world!"], { type: "text/plain" });
//     const bytes = await blob.arrayBuffer();
//     const json = convexToJson(bytes);
//     console.log(json);
//   },
// });

export const t = action({
  args: {
    bytes: v.bytes(),
  },
  handler: async (ctx, args) => {
    console.log(args.bytes);
    const json = convexToJson(args.bytes);
    console.log(json);
    const blob = new Blob([args.bytes], { type: "text/plain" });
    const bytes2 = await blob.arrayBuffer();
    const text = new TextDecoder().decode(bytes2);
    console.log(text);
    console.log(convexToJson(bytes2));
    console.log(bytes2.byteLength);
    const storageId = await ctx.storage.store(blob);
    const metadata = await ctx.storage.getMetadata(storageId);
    console.log(metadata);
  },
});

export const httpHandler = httpAction(async (ctx, req) => {
  const blob = await req.blob();
  const bytes = await blob.slice().arrayBuffer();
  // const text = new TextDecoder().decode(bytes);
  console.log(blob.type);
  console.log(blob.size);
  console.log(bytes.byteLength);
  const storageId = await ctx.storage.store(
    new Blob([bytes], { type: "text/plain" }),
  );
  const metadata = await ctx.storage.getMetadata(storageId);
  console.log(metadata);
  return new Response(
    JSON.stringify({ storageId, metadata, blobSize: blob.size }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
});
