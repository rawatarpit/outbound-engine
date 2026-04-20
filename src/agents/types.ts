import { z } from "zod";

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
  industry: z.string(),
  size_estimate: z.string(),
  pain_points: z.string(),
  buying_signals: z.string(),
  automation_maturity: z.string(),
  sponsorship_potential: z.string(),
  summary: z.string(),
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
