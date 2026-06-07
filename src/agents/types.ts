import { z } from "zod";
import { AgentResultStatus, type AgentResult as HarnessAgentResult, type AgentTurnLog } from "../harness/types";

export { AgentResultStatus };

export interface AgentResult<T> {
  status: AgentResultStatus;
  data?: T;
  error?: string;
}

export function toHarnessResult<T>(result: AgentResult<T>, log?: AgentTurnLog): HarnessAgentResult<T> {
  return { status: result.status, data: result.data, error: result.error, log };
}

export const qualificationResultSchema = z.object({
  fit_score: z.number().min(0).max(100),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

export type QualificationResult = z.infer<typeof qualificationResultSchema>;

export const outreachResultSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export type OutreachResult = z.infer<typeof outreachResultSchema>;

export const negotiationResultSchema = z.object({
  draft: z.string().min(10),
});

export type NegotiationResult = z.infer<typeof negotiationResultSchema>;

export const researchResultSchema = z.object({
  industry: z.string().catch(""),
  size_estimate: z.string().catch(""),
  pain_points: z.union([z.string(), z.array(z.string())]).catch("").transform(v => Array.isArray(v) ? v.join(", ") : v),
  buying_signals: z.union([z.string(), z.array(z.string())]).catch("").transform(v => Array.isArray(v) ? v.join(", ") : v),
  automation_maturity: z.string().catch(""),
  sponsorship_potential: z.union([z.boolean(), z.string()]).catch(false).transform(v => typeof v === "boolean" ? v : v.toLowerCase() === "true"),
  summary: z.string().catch(""),
});

export type ResearchResult = z.infer<typeof researchResultSchema>;

export const replyAnalysisResultSchema = z.object({
  intent: z.enum(["high", "medium", "low", "negative", "unsubscribe", "ooo"]),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  objection_detected: z.boolean(),
  meeting_requested: z.boolean(),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});

export type ReplyAnalysisResult = z.infer<typeof replyAnalysisResultSchema>;

export function success<T>(data: T): AgentResult<T> {
  return { status: AgentResultStatus.SUCCESS, data };
}

export function retryableFailure(error: string): AgentResult<never> {
  return { status: AgentResultStatus.RETRYABLE_FAILURE, error };
}

export function terminalFailure(error: string): AgentResult<never> {
  return { status: AgentResultStatus.TERMINAL_FAILURE, error };
}

export function skipped(reason: string): AgentResult<never> {
  return { status: AgentResultStatus.SKIPPED, error: reason };
}
