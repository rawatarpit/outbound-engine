import pino from "pino";
import type { AgentTurnLog } from "./types";

const logger = pino({ level: "info" });

let runCounter = 0;

export function createRunId(agentId: string): string {
  runCounter++;
  const ts = Date.now().toString(36);
  return `${agentId}-${ts}-${runCounter}`;
}

export function logAgentTurn(turnLog: AgentTurnLog): void {
  logger.info({
    ...turnLog,
    type: "agent_turn",
  }, `Agent ${turnLog.agent_id} turn ${turnLog.turn} — ${turnLog.stop_reason}`);

  if (turnLog.context_utilization_pct > 80) {
    logger.warn({
      agent_id: turnLog.agent_id,
      turn: turnLog.turn,
      context_utilization_pct: turnLog.context_utilization_pct,
    }, "Context utilization above 80%");
  }

  if (turnLog.tool_errors.length > 2) {
    logger.warn({
      agent_id: turnLog.agent_id,
      turn: turnLog.turn,
      tool_errors: turnLog.tool_errors,
    }, "Multiple tool failures in one turn");
  }
}
