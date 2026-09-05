// See the docs at https://docs.convex.dev/agents/files
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

// Registered in convex/crons.ts
export const deleteUnusedFiles = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const files = await ctx.runQuery(components.agent.files.getFilesToDelete, {
      paginationOpts: {
        cursor: args.cursor ?? null,
        numItems: 100,
      },
    });
    // Recheck eligibility and only delete blobs with no remaining file records.
    const { storageIdsToDelete } = await ctx.runMutation(
      components.agent.files.deleteFilesWithStorageIds,
      { fileIds: files.page.map((file) => file._id) },
    );
    // Both operations share this mutation's transaction. Let storage errors
    // propagate so that deleting the component records also rolls back.
    await Promise.all(
      storageIdsToDelete.map((storageId) =>
        ctx.storage.delete(storageId as Id<"_storage">),
      ),
    );
    if (!files.isDone) {
      console.debug(
        `Deleted ${storageIdsToDelete.length} blobs but not done yet, continuing...`,
      );
      await ctx.scheduler.runAfter(0, internal.files.vacuum.deleteUnusedFiles, {
        cursor: files.continueCursor,
      });
    }
  },
});
