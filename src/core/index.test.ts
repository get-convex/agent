import { expect, expectTypeOf, test } from "vitest";
import type {
  Message,
  MessageContentParts,
  MessageDoc,
  MessageWithMetadata,
  Usage,
} from "../validators.js";
import {
  vAgentMessage,
  vAgentMessageDoc,
  vAgentMessageInput,
  vAgentUsage,
  vMessage,
  vMessageDoc,
  vMessageWithMetadata,
  vUsage,
} from "../validators.js";
import type {
  AgentMessage,
  AgentMessageDoc,
  AgentMessageInput,
  AgentMessagePart,
  AgentUsage,
} from "./index.js";

test("Agent data types match the canonical persisted data model", () => {
  expectTypeOf<AgentMessage>().toEqualTypeOf<Message>();
  expectTypeOf<AgentMessagePart>().toEqualTypeOf<MessageContentParts>();
  expectTypeOf<AgentMessageDoc>().toEqualTypeOf<MessageDoc>();
  expectTypeOf<AgentMessageInput>().toEqualTypeOf<MessageWithMetadata>();
  expectTypeOf<AgentUsage>().toEqualTypeOf<Usage>();

  expect(vAgentMessage).toBe(vMessage);
  expect(vAgentMessageDoc).toBe(vMessageDoc);
  expect(vAgentMessageInput).toBe(vMessageWithMetadata);
  expect(vAgentUsage).toBe(vUsage);
});
