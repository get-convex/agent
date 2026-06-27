import type {
  AgentMessage,
  AgentMessageInput,
  AgentMessageInputInternal,
} from "../validators.js";

function isAgentMessageInput(
  message: AgentMessage | AgentMessageInput,
): message is AgentMessageInput {
  return "message" in message;
}

export function normalizeMessage(
  message: AgentMessage | AgentMessageInput,
): AgentMessageInputInternal {
  if (!isAgentMessageInput(message)) {
    return { message };
  }
  return { ...message };
}
