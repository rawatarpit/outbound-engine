export {
  buildSystemPrompt,
  buildResearchPrompt,
  buildQualificationPrompt,
  buildOutreachPrompt,
} from "./promptBuilder";

export {
  defaultBudget,
  estimateTokens,
  truncateToBudget,
  truncateMessages,
  assembleContext,
  buildContextPreamble,
} from "./contextManager";

export type { HarnessContextInput } from "./contextManager";

export {
  createMemoryStore,
  injectWorkingMemory,
  extractWorkingMemory,
  formatAssistantResponse,
} from "./memory";

export type { MemoryStore } from "./memory";

export {
  createRunId,
  logAgentTurn,
} from "./observability";

export {
  withRetry,
  withFallback,
  structuredError,
  isNonRetryable,
  getErrorSuggestion,
} from "./errorHandling";

export type { RetryConfig } from "./errorHandling";

export {
  LEAD_GEN_TOOLS,
  getToolByName,
  getToolsByCategory,
} from "./toolRegistry";

export {
  ADAPTER_TOOLS,
  getAdapterTool,
  getAdapterToolsBySource,
} from "./adapterTools";

export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  AgentTurnLog,
  ContextBudget,
  AgentConfig,
  LoopConfig,
  AgentContext,
  AgentResult,
} from "./types";

export { AgentResultStatus } from "./types";

// ── Orchestration / Workflow ────────────────────────────────────────────

export { routeIntent } from "./router";
export type {
  ChatIntent,
  PipelineStage,
  PipelineState,
  RouterOutput,
  PlannerOutput,
  SynthesizerOutput,
  PlannerStep,
  WorkflowStep,
  ExecutionPlan,
  StepResult,
  ProgressCallback,
} from "./types";

export { generatePlan } from "./planner";

export { executePlan } from "./dispatcher";

export { synthesizeResults } from "./synthesizer";

export { runAgentLoop } from "./agentLoop";
export type { AgentLoopInput, AgentLoopOutput } from "./agentLoop";
