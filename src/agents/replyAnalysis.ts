import pino from "pino";
import { supabase, updateCompanyStatus, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import {
  replyAnalysisResultSchema,
  success,
  retryableFailure,
  terminalFailure,
  skipped,
  type AgentResult,
} from "./types";
import {
  assembleContext,
  createRunId,
  logAgentTurn,
  structuredError,
} from "../harness";

const logger = pino({ level: "info" });
const CONFIDENCE_THRESHOLD = 0.75;

export async function runReplyAnalysis(
  companyId: string,
  messageId: string,
  rawMessage: string,
): Promise<
  AgentResult<{
    intent: string;
    sentiment: string;
    objection_detected: boolean;
    meeting_requested: boolean;
    confidence: number;
    summary: string;
  }>
> {
  const runId = createRunId("reply-analysis");
  const startTime = Date.now();

  if (!messageId || !rawMessage) {
    return terminalFailure("Message ID and raw message are required");
  }

  try {
    const { data: company } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle();

    if (!company) {
      return terminalFailure(`Company not found: ${companyId}`);
    }

    const brand = await getBrandProfile(company.brand_id ?? "");
    if (!brand) {
      return terminalFailure(`Brand profile not found: ${company.brand_id}`);
    }
    if (!brand.is_active) {
      return terminalFailure(`Brand is not active: ${brand.brand_name}`);
    }

    const { data: existing } = await supabase
      .from("replies")
      .select("analyzed_at")
      .eq("message_id", messageId)
      .maybeSingle();

    if (!existing) {
      return terminalFailure(`Reply not found for message: ${messageId}`);
    }

    if (existing.analyzed_at) {
      logger.info(`Reply already analyzed → ${companyId}`);
      return skipped("Reply already analyzed");
    }

    const agentContext = await assembleContext({
      company: { id: companyId, name: company.name, brand_id: company.brand_id },
      brand,
      stage: "reply",
    });
    const compactionBlock = agentContext.compaction
      ? `${agentContext.compaction}\n\n`
      : "";

    const prompt = `${compactionBlock}You are the founder of ${brand.brand_name}.

Brand Context:
Positioning: ${brand.positioning ?? "N/A"}
Tone: ${brand.tone ?? "Professional"}
Negotiation Style: ${brand.negotiation_style ?? "Balanced"}

Analyze this email reply:

${rawMessage}

Return JSON:
intent,
sentiment,
objection_detected,
meeting_requested,
confidence,
summary
`;

    const parsed = await generateStructured(prompt, replyAnalysisResultSchema, undefined, brand.client_id ?? undefined);

    const { error: updateError } = await supabase
      .from("replies")
      .update({
        intent: parsed.intent,
        sentiment: parsed.sentiment,
        objection_detected: parsed.objection_detected,
        meeting_requested: parsed.meeting_requested,
        confidence: parsed.confidence,
        summary: parsed.summary,
        analyzed_at: new Date().toISOString(),
      })
      .eq("message_id", messageId);

    if (updateError) {
      logger.error({ error: updateError }, "Failed to update reply");
      return retryableFailure(`Database error: ${updateError.message}`);
    }

    const { data: currentCompany } = await supabase
      .from("companies")
      .select("status")
      .eq("id", companyId)
      .maybeSingle();

    const currentStatus = currentCompany?.status ?? company.status;
    await updateCompanyStatus(companyId, currentStatus, "replied", company.brand_id);

    if (parsed.intent === "unsubscribe") {
      const fromMatch = rawMessage.match(/^From:\s.*?<([^>]+)>/im);
      const senderEmail = fromMatch?.[1]?.toLowerCase();
      if (senderEmail) {
        const domain = senderEmail.split("@")[1];
        await supabase.from("suppression_list").insert({
          brand_id: brand.id,
          email: senderEmail,
          domain,
          reason: "unsubscribe_request",
        });
      }
      await updateCompanyStatus(companyId, "replied", "closed_lost", company.brand_id);
    }

    logAgentTurn({
      run_id: runId,
      agent_id: "reply-analysis",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: Math.ceil(prompt.length / 4),
      output_tokens: Math.ceil(JSON.stringify(parsed).length / 4),
      tools_called: ["analyze_reply", "save_to_database"],
      tool_latencies_ms: { analyze_reply: Date.now() - startTime },
      tool_errors: [],
      stop_reason: "completed",
      cost_usd: 0,
      context_utilization_pct: 0,
    });

    return success({
      intent: parsed.intent,
      sentiment: parsed.sentiment,
      objection_detected: parsed.objection_detected,
      meeting_requested: parsed.meeting_requested,
      confidence: parsed.confidence,
      summary: parsed.summary,
    });
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    logger.error({ err: message }, "Reply analysis failed");

    logAgentTurn({
      run_id: runId,
      agent_id: "reply-analysis",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: 0,
      output_tokens: 0,
      tools_called: [],
      tool_latencies_ms: {},
      tool_errors: [structuredError({ tool: "analyze_reply", message, input: { companyId } })],
      stop_reason: "error",
      cost_usd: 0,
      context_utilization_pct: 0,
    });

    if (message.includes("parse") || message.includes("invalid")) {
      return terminalFailure(`LLM parsing error: ${message}`);
    }
    return retryableFailure(message);
  }
}
