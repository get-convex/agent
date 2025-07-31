import { action } from "../_generated/server";
import { v } from "convex/values";

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
    const hashArray = Array.from(new Uint8Array(
      await crypto.subtle.digest("SHA-256", buffer)
    ));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  },
});
