import { z } from "zod";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: z.ZodTypeAny;
  executor: (input: any) => Promise<any>;
  output_description?: string;
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

// ── Workflow / Orchestration Types ──────────────────────────────────────

export interface WorkflowStep {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  parallel_group: string | null;
  depends_on: string[];
  max_retries: number;
  timeout_ms: number;
}

export interface ExecutionPlan {
  steps: WorkflowStep[];
  brand_id: string;
  client_id: string;
  intent: string;
  max_leads: number;
}

export interface StepExecutionResult {
  step_id: string;
  tool: string;
  status: "success" | "error" | "skipped";
  output: unknown;
  error?: string;
  duration_ms: number;
}

export type ProgressEvent =
  | { type: "step_start"; step_id: string; tool: string }
  | { type: "step_result"; step_id: string; tool: string; data?: unknown }
  | { type: "step_error"; step_id: string; tool: string; error?: string };

// ── Pipeline State Machine ──────────────────────────────────────────

export type PipelineStage =
  | "init"
  | "discovery"
  | "research"
  | "enrich"
  | "qualify"
  | "draft"
  | "send"
  | "done";

export interface PipelineState {
  stage: PipelineStage;
  leads: unknown[];
  researched: unknown[];
  enriched: unknown[];
  qualified: unknown[];
  drafts: unknown[];
  sent: unknown[];
  searchQueries: string[];
  intentDescription: string;
  brandId: string;
  clientId: string;
}

// ── Router Output ───────────────────────────────────────────────────

export type ChatIntent =
  | "discover"
  | "research"
  | "enrich"
  | "qualify"
  | "outreach"
  | "send"
  | "pipeline"
  | "analyze"
  | "chat";

export interface RouterOutput {
  intent: ChatIntent;
  parameters: Record<string, unknown>;
  confidence: number;
  missingParams: string[];
}

// ── Planner Output ──────────────────────────────────────────────────

export interface PlannerStep {
  tool: string;
  input: Record<string, unknown>;
  dependsOn: number[];
}

export interface PlannerOutput {
  steps: PlannerStep[];
  searchQueries?: string[];
  intentDescription?: string;
}

// ── Synthesizer Output ──────────────────────────────────────────────

export interface SynthesizerOutput {
  message: string;
  suggestions: string[];
  askClarification?: string[];
  saveCampaign?: {
    shouldSave: boolean;
    summary: string;
    queries: string[];
  };
}

// ── Dispatcher Types ────────────────────────────────────────────────

export interface StepResult {
  step_id: string;
  tool: string;
  status: "success" | "error" | "skipped";
  output: unknown;
  error?: string;
  duration_ms: number;
}

export type ProgressCallback = (event: {
  type: "step_start" | "step_result" | "step_error";
  step_id: string;
  tool: string;
  data?: unknown;
  error?: string;
}) => void;

// ── Agentic Loop Types ─────────────────────────────────────────────

export interface UserPreferences {
  likedCompanyIds: string[];
  dislikedCompanyIds: string[];
  preferredKeywords: string[];
  avoidKeywords: string[];
  batchCount: number;
}

export interface AgenticToolCallRecord {
  name: string;
  input: unknown;
  result: unknown;
  status: "success" | "error" | "skipped";
  duration_ms: number;
}

export interface AgenticTurn {
  turn: number;
  toolCalls: AgenticToolCallRecord[];
  reasoning?: string;
}

export interface AgenticState {
  turns: AgenticTurn[];
  preferences: UserPreferences;
  isDone: boolean;
}

// ── Reasoner Types ────────────────────────────────────────────────

export interface ReasonedToolCall {
  name: string;
  input: Record<string, unknown>;
  parallel_group: string | null;
  reason: string;
  depends_on: string[];
}

export interface ReasonerOutput {
  toolCalls: ReasonedToolCall[];
  isFinal: boolean;
  reasoning?: string;
}

