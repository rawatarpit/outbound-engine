import pino from "pino";
import type { WorkflowStep as PlanStep, ExecutionPlan, StepResult, ProgressCallback } from "./types";

export type { StepResult, ProgressCallback };
import { OrchestratorConfig } from "../config/reliability";
import { executeTool, type ToolInput } from "../agentLoop/handlers";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export async function executePlan(
  plan: ExecutionPlan,
  onProgress?: ProgressCallback,
): Promise<StepResult[]> {
  const results = new Map<string, StepResult>();
  const completed = new Set<string>();

  const groups = groupSteps(plan.steps);

  for (const group of groups) {
    const pending = group.filter((step) => {
      return step.depends_on.every((dep) => completed.has(dep));
    });

    const batchResults = await Promise.allSettled(
      pending.map((step) => executeStep(step, plan, results, onProgress)),
    );

    for (let i = 0; i < pending.length; i++) {
      const step = pending[i];
      const r = batchResults[i];

      if (r.status === "fulfilled") {
        results.set(step.id, r.value);
        completed.add(step.id);
      } else {
        logger.error({ step_id: step.id, error: r.reason }, "Step failed");
        results.set(step.id, {
          step_id: step.id,
          tool: step.tool,
          status: "error",
          output: null,
          error: r.reason?.message || String(r.reason),
          duration_ms: 0,
        });
        completed.add(step.id);
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return plan.steps.map((s) => results.get(s.id)!).filter(Boolean);
}

function groupSteps(steps: PlanStep[]): PlanStep[][] {
  const groups: PlanStep[][] = [];
  const remaining = [...steps];

  while (remaining.length > 0) {
    const ready = remaining.filter((s) =>
      s.depends_on.every((d) => !remaining.find((r) => r.id === d)),
    );

    if (ready.length === 0) break;

    groups.push(ready);
    ready.forEach((r) => remaining.splice(remaining.indexOf(r), 1));
  }

  if (remaining.length > 0) {
    groups.push(remaining);
  }

  return groups;
}

async function executeStep(
  step: PlanStep,
  _plan: ExecutionPlan,
  _allResults: Map<string, StepResult>,
  onProgress?: ProgressCallback,
): Promise<StepResult> {
  const start = Date.now();

  onProgress?.({ type: "step_start", step_id: step.id, tool: step.tool });

  try {
    const output = await executeTool(step.tool, step.input as ToolInput);
    const duration = Date.now() - start;

    const result: StepResult = {
      step_id: step.id,
      tool: step.tool,
      status: "success",
      output,
      duration_ms: duration,
    };

    onProgress?.({ type: "step_result", step_id: step.id, tool: step.tool, data: output });
    return result;
  } catch (err: any) {
    const duration = Date.now() - start;
    const error = err?.message || String(err);

    onProgress?.({ type: "step_error", step_id: step.id, tool: step.tool, error });

    return {
      step_id: step.id,
      tool: step.tool,
      status: "error",
      output: null,
      error,
      duration_ms: duration,
    };
  }
}
