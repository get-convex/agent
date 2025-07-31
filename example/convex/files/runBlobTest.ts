import { action } from "../_generated/server";
import { v } from "convex/values";

export const runBlobConsumptionTest = action({
  args: {},
  handler: async (ctx, args) => {
    const testContent = "This is a test file to check blob consumption behavior";
    const filename = "blob-test.txt";
    
    console.log("=== Testing Blob Consumption Behavior ===");
    
    const blob1 = new Blob([testContent], { type: "text/plain" });
    console.log("Original blob size:", blob1.size);
    
    const buffer = await blob1.arrayBuffer();
    console.log("ArrayBuffer size:", buffer.byteLength);
    console.log("Blob size after arrayBuffer():", blob1.size);
    
    const storageId1 = await ctx.storage.store(blob1);
    const metadata1 = await ctx.storage.getMetadata(storageId1);
    
    console.log("Stored file metadata:", metadata1);
    
    const blob2 = new Blob([testContent], { type: "text/plain" });
    const storageId2 = await ctx.storage.store(blob2);
    const metadata2 = await ctx.storage.getMetadata(storageId2);
    
    console.log("Control blob (no arrayBuffer call) metadata:", metadata2);
    
    return {
      blobAfterArrayBuffer: {
        originalSize: blob1.size,
        storedSize: metadata1?.size || 0,
        isZeroByteFile: (metadata1?.size || 0) === 0,
      },
      controlBlob: {
        originalSize: blob2.size,
        storedSize: metadata2?.size || 0,
        isZeroByteFile: (metadata2?.size || 0) === 0,
      },
    };
  },
});
