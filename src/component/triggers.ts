/* eslint-disable no-restricted-imports */
import { mutation as rawMutation, internalMutation as rawInternalMutation } from "./_generated/server.js";
/* eslint-enable no-restricted-imports */
import type { DataModel } from "./_generated/dataModel.js";
import { Triggers } from "convex-helpers/server/triggers";
import { customCtx, customMutation } from "convex-helpers/server/customFunctions";

// Simple, canonical trigger setup following convex-helpers docs.
// Provide a global singleton so importing from different module paths shares registrations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const triggers: Triggers<DataModel> = new Triggers<DataModel>();


// Wrap the built-in mutation builders so that any ctx.db.* write calls fire triggers.
export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(triggers.wrapDB),
);

// Export the triggers instance so apps can call triggers.register("messages", ...)
// This is the same instance that wraps the mutations above
export { triggers };
