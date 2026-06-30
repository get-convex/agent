/**
 * Vercel AI SDK integration for Convex Agent.
 *
 * @remarks
 * This entrypoint adapts AI SDK 7 model providers to Agent's Convex-native
 * model interface. React chat transport helpers live in
 * `@convex-dev/agent/vercel/react`.
 *
 * @packageDocumentation
 */

export { defineModel, type ModelOptions } from "./model.js";
