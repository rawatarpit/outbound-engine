import { z } from "zod";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: z.ZodTypeAny;
  executor: (input: any) => Promise<any>;
  metadata: {
    category: "search" | "storage" | "compute" | "io" | "agent";
    timeout_ms: number;
    retryable: boolean;
    requires_confirmation: boolean;
    cost_tier: "free" | "cheap" | "expensive";
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: any;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export interface AgentTurnLog {
  run_id: string;
  agent_id: string;
  turn: number;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  tools_called: string[];
  tool_latencies_ms: Record<string, number>;
  tool_errors: string[];
  stop_reason: string;
  cost_usd: number;
  context_utilization_pct: number;
}

export interface ContextBudget {
  system: number;
  memory: number;
  conversation: number;
  tool_results: number;
  response: number;
}

export interface AgentConfig {
  identity: string;
  objective: string;
  capabilities: string;
  constraints: string;
  outputFormat: string;
  injectedContext: string;
}

export interface LoopConfig {
  maxIterations: number;
  maxTokens: number;
}

export interface AgentContext {
  workingMemory: string[];
  taskContext: string;
  budget: ContextBudget;
}

export enum AgentResultStatus {
  SUCCESS = "SUCCESS",
  RETRYABLE_FAILURE = "RETRYABLE_FAILURE",
  TERMINAL_FAILURE = "TERMINAL_FAILURE",
  SKIPPED = "SKIPPED",
}

export interface AgentResult<T> {
  status: AgentResultStatus;
  data?: T;
  error?: string;
  log?: AgentTurnLog;
}
