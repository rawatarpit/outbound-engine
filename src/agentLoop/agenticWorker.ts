import pino from "pino";
import { BrandProfile } from "../db/supabase";
import { reasonNextTools } from "./reasoner";
import { executeTool, ToolInput } from "./handlers";
import { synthesizeResults } from "../harness/synthesizer";
import {
  PipelineState, UserPreferences, ReasonerOutput, ReasonedToolCall,
  AgenticState, AgenticTurn, AgenticToolCallRecord, StepResult, RouterOutput, SynthesizerOutput,
} from "../harness/types";
import {
  getSession, addMessage, getPipelineState, updatePipelineState, setPipelineStage,
  incrementBatchCount, getUserPreferences, updateUserPreferences, getConversationContext,
} from "./conversation";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const MAX_TURNS = 8;
const MAX_CONCURRENT = 5;

interface AgenticWorkerInput {
  message: string;
  brand: BrandProfile;
  intent: RouterOutput;
  sessionId: string;
}

interface AgenticWorkerOutput {
  results: StepResult[];
  response: SynthesizerOutput;
  toolCalls: number;
  turns: number;
}

export async function runAgenticWorker(input: AgenticWorkerInput): Promise<AgenticWorkerOutput> {
  const { message, brand, intent, sessionId } = input;
  const preferences = getUserPreferences(sessionId);
  const conversationContext = getConversationContext(sessionId);

  let allResults: StepResult[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Refresh pipeline state each turn to see updated results
    const state = getPipelineState(sessionId)!;
    const decision = await reasonNextTools({
      intent: intent.intent,
      parameters: intent.parameters,
      state: state!,
      preferences,
      brand,
      userMessage: message,
    });

    if (decision.isFinal || decision.toolCalls.length === 0) {
      break;
    }

    // Group tool calls by parallel_group for concurrent execution
    const groups = groupByParallelGroup(decision.toolCalls);
    for (const group of groups) {
      const batchResults = await executeToolGroup(group, brand, sessionId);
      allResults.push(...batchResults);

      // Update pipeline state with results
      updatePipelineStateFromResults(sessionId, batchResults, decision, state!);
    }

    // Increment batch count if discovery was run
    if (allResults.some(r => r.tool === "discover_leads" && r.status === "success")) {
      incrementBatchCount(sessionId);
    }
  }

  // Synthesize final response
  const newStage = getPipelineState(sessionId)?.stage || "init";
  const response = await synthesizeResults({
    userMessage: message,
    results: allResults,
    brand,
    stage: newStage,
    searchQueries: (intent.parameters.search_queries as string[]) || getPipelineState(sessionId)?.searchQueries || [],
    intentDescription: intent.intent,
    previousMessages: conversationContext,
  });

  addMessage(sessionId, {
    role: "assistant",
    content: response.message,
    tool_results: allResults.map(r => ({ name: r.tool, output: r.output })),
    created_at: new Date().toISOString(),
  });

  return {
    results: allResults,
    response: response as SynthesizerOutput,
    toolCalls: allResults.length,
    turns: allResults.length > 0 ? 1 : 0,
  };
}

function groupByParallelGroup(toolCalls: ReasonedToolCall[]): ReasonedToolCall[][] {
  const groups = new Map<string, ReasonedToolCall[]>();

  for (const tc of toolCalls) {
    const groupKey = tc.parallel_group || "default";
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(tc);
  }

  // Check for dependent groups
  const ordered: ReasonedToolCall[][] = [];
  const resolved = new Set<string>();
  const groupOrder = [...groups.keys()];

  // Simple dependency resolution: groups with depends_on on tools in earlier groups
  const groupDepends = new Map<string, string[]>();
  for (const [gKey, tools] of groups) {
    const deps = tools.flatMap(t => t.depends_on);
    // Find which groups these dependencies belong to
    const depGroups = deps.map(d => {
      for (const [gk, gt] of groups) {
        if (gt.some(t => t.name === d)) return gk;
      }
      return null;
    }).filter(Boolean) as string[];
    groupDepends.set(gKey, [...new Set(depGroups)]);
  }

  // Topological sort (simple)
  while (ordered.length < groupOrder.length) {
    for (const [gKey, deps] of groupDepends) {
      if (resolved.has(gKey)) continue;
      if (deps.every(d => resolved.has(d))) {
        ordered.push(groups.get(gKey)!);
        resolved.add(gKey);
      }
    }
  }

  return ordered.length > 0 ? ordered : groupOrder.map(g => groups.get(g)!);
}

async function executeToolGroup(group: ReasonedToolCall[], brand: BrandProfile, sessionId: string): Promise<StepResult[]> {
  // Limit concurrent calls
  const limited = group.slice(0, MAX_CONCURRENT);
  const stepId = `${Date.now()}`;

  const results = await Promise.allSettled(
    limited.map((tc, i) => executeSingleTool(tc, brand, `${stepId}_${i}`))
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      step_id: `${stepId}_${i}`,
      tool: limited[i].name,
      status: "error" as const,
      output: null,
      error: r.reason?.message || String(r.reason),
      duration_ms: 0,
    };
  });
}

async function executeSingleTool(tc: ReasonedToolCall, brand: BrandProfile, stepId: string): Promise<StepResult> {
  const start = Date.now();
  try {
    const output = await executeTool(tc.name, tc.input as ToolInput);
    return {
      step_id: stepId,
      tool: tc.name,
      status: "success",
      output,
      duration_ms: Date.now() - start,
    };
  } catch (err: any) {
    return {
      step_id: stepId,
      tool: tc.name,
      status: "error",
      output: null,
      error: err.message,
      duration_ms: Date.now() - start,
    };
  }
}

function updatePipelineStateFromResults(sessionId: string, results: StepResult[], decision: ReasonerOutput, currentState: PipelineState): void {
  for (const r of results) {
    if (r.status !== "success") continue;

    switch (r.tool) {
      case "discover_leads": {
        const output = r.output as any;
        const leads = output?.leads ?? [];
        updatePipelineState(sessionId, {
          leads: [...currentState.leads, ...leads],
          stage: "discovery",
        });
        break;
      }
      case "research_leads": {
        const output = r.output as any;
        updatePipelineState(sessionId, {
          researched: [...currentState.researched, ...(output?.researched ?? [])],
          stage: "research",
        });
        break;
      }
      case "enrich_leads": {
        const output = r.output as any;
        updatePipelineState(sessionId, {
          enriched: [...currentState.enriched, ...(output?.contacts ?? [])],
          stage: "enrich",
        });
        break;
      }
      case "qualify_leads": {
        const output = r.output as any;
        updatePipelineState(sessionId, {
          qualified: [...currentState.qualified, ...(output?.qualified ?? [])],
          stage: "qualify",
        });
        break;
      }
      case "draft_emails": {
        const output = r.output as any;
        updatePipelineState(sessionId, {
          drafts: [...currentState.drafts, ...(output?.drafts ?? [])],
          stage: "draft",
        });
        break;
      }
      case "send_emails": {
        const output = r.output as any;
        updatePipelineState(sessionId, {
          sent: [...currentState.sent, ...(output?.sent ?? [])],
          stage: "send",
        });
        break;
      }
    }
  }
}
