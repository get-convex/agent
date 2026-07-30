export type AgentInstructionOverride = {
  agentName: string;
  value: string;
};

export function instructionOverrideForAgent(
  override: AgentInstructionOverride | undefined,
  agentName: string | undefined,
): string | undefined {
  return override?.agentName === agentName ? override.value : undefined;
}

export function updateInstructionOverride(
  agentName: string | undefined,
  editableInstructions: string | undefined,
  value: string,
): AgentInstructionOverride | undefined {
  if (agentName === undefined || value === (editableInstructions ?? "")) {
    return undefined;
  }
  return { agentName, value };
}
