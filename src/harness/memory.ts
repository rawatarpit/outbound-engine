import pino from "pino";

const logger = pino({ level: "info" });

export interface MemoryStore {
  workingMemory: string[];
  longTermMemory: string[];
}

export function createMemoryStore(initialFacts?: string[]): MemoryStore {
  return {
    workingMemory: initialFacts ?? [],
    longTermMemory: [],
  };
}

export function injectWorkingMemory(
  systemPrompt: string,
  workingMemory: string[],
  taskContext: string,
): string {
  if (workingMemory.length === 0 && !taskContext) return systemPrompt;

  const blocks: string[] = [systemPrompt];

  if (workingMemory.length > 0) {
    blocks.push(
      ``,
      `## What I know about this session`,
      workingMemory.map(m => `- ${m}`).join("\n"),
    );
  }

  if (taskContext) {
    blocks.push(
      ``,
      `## Active task context`,
      taskContext,
    );
  }

  return blocks.join("\n");
}

export function extractWorkingMemory(
  previousMemory: string[],
  newFacts: string[],
  maxItems: number = 10,
): string[] {
  const combined = [...previousMemory, ...newFacts];
  const unique = [...new Set(combined)];
  return unique.slice(-maxItems);
}

export function formatAssistantResponse(
  content: string,
  metadata?: Record<string, unknown>,
): string {
  const meta = metadata ? `\n\n[Metadata: ${JSON.stringify(metadata)}]` : "";
  return content + meta;
}
