import type { ContextBudget } from "./types";
import { assembleContext as assembleDiscoveryContext, type AgentContext as DiscoveryContext } from "../discovery/harness/contextAssembler";

export function defaultBudget(): ContextBudget {
  return {
    system: 2_000,
    memory: 4_000,
    conversation: 40_000,
    tool_results: 20_000,
    response: 8_000,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToBudget(
  text: string,
  maxTokens: number,
): string {
  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  return text.slice(0, maxChars) + `\n[truncated: ${tokens} tokens > ${maxTokens} limit]`;
}

export function truncateMessages<T extends { role: string; content: any }>(
  messages: T[],
  maxTokens: number,
  tokenCounter: (m: T[]) => number,
): T[] {
  if (tokenCounter(messages) <= maxTokens) return messages;

  const head = messages.slice(0, 1);
  const tail = messages.slice(-6);
  const middle = messages.slice(1, -6);

  while (middle.length > 0 && tokenCounter([...head, ...middle, ...tail]) > maxTokens) {
    middle.shift();
  }

  return [...head, ...middle, ...tail];
}

export interface HarnessContextInput {
  company: { id: string; name?: string | null; domain?: string | null; brand_id?: string | null };
  brand: any;
  intentId?: string;
  stage: "research" | "qualification" | "outreach" | "discovery" | "scoring" | "reply" | "negotiation";
}

export async function assembleContext(input: HarnessContextInput): Promise<DiscoveryContext> {
  return assembleDiscoveryContext({
    company: input.company as any,
    brand: input.brand,
    intentId: input.intentId,
    stage: input.stage,
  });
}

export function buildContextPreamble(
  agentContext: DiscoveryContext,
  stages?: ("similar" | "outcomes" | "sources" | "enrichment" | "conversion")[],
): string {
  const blocks: string[] = [];

  const shouldInclude = (s: string) => !stages || stages.includes(s as any);

  if (shouldInclude("similar") && agentContext.similarCompanies.length > 0) {
    const similar = agentContext.similarCompanies.slice(0, 3).map(c =>
      `- ${c.name} (${c.domain}): ${c.outcome} (similarity: ${(c.similarity * 100).toFixed(1)}%)`
    ).join("\n");
    blocks.push(`=== SIMILAR COMPANIES ===\n${similar}`);
  }

  if (shouldInclude("outcomes") && agentContext.pastOutcomes.length > 0) {
    const outcomes = agentContext.pastOutcomes.map(o =>
      `- ${o.type}: ${o.count} companies (avg score: ${o.avgScore})`
    ).join("\n");
    blocks.push(`=== PAST OUTCOMES ===\n${outcomes}`);
  }

  if (shouldInclude("sources") && agentContext.sourcePerformance.length > 0) {
    const sources = agentContext.sourcePerformance.slice(0, 3).map(s =>
      `- ${s.source}: ${s.sends} sends, ${s.replies} replies (${s.conversionRate.toFixed(1)}% conversion)`
    ).join("\n");
    blocks.push(`=== SOURCE PERFORMANCE ===\n${sources}`);
  }

  if (shouldInclude("enrichment") && agentContext.enrichmentHistory.length > 0) {
    const histories = agentContext.enrichmentHistory.slice(0, 3).map(h =>
      `- ${h.domain}: ${h.strategies.join(", ")} (confidence: ${h.confidence.toFixed(2)})`
    ).join("\n");
    blocks.push(`=== ENRICHMENT HISTORY ===\n${histories}`);
  }

  if (shouldInclude("conversion") && agentContext.conversionPatterns.length > 0) {
    blocks.push(`=== CONVERSION PATTERNS ===\n${agentContext.conversionPatterns.join("\n")}`);
  }

  return blocks.length > 0 ? blocks.join("\n\n") : "";
}
