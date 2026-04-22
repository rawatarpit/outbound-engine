import pino from "pino";
import { z } from "zod";
import { supabase, updateCompanyStatus, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import { sanitizeForPrompt } from "../llm/sanitize";
import {
  AgentResult,
  replyAnalysisResultSchema,
  success,
  retryableFailure,
  terminalFailure,
  skipped,
} from "./types";

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
  if (!messageId || !rawMessage) {
    return terminalFailure("Message ID and raw message are required");
  }

  try {
    /* ===========================
       LOAD COMPANY
    =========================== */

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

    /* ===========================
       ENSURE REPLY EXISTS
    =========================== */

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

    /* ===========================
       LLM ANALYSIS
    =========================== */

    const prompt = `
You are the founder of ${sanitizeForPrompt(brand.brand_name)}.

Brand Context:
Positioning: ${sanitizeForPrompt(brand.positioning ?? "N/A")}
Tone: ${sanitizeForPrompt(brand.tone ?? "Professional")}
Negotiation Style: ${sanitizeForPrompt(brand.negotiation_style ?? "Balanced")}

Analyze this email reply:

${sanitizeForPrompt(rawMessage)}

Return JSON:
intent,
sentiment,
objection_detected,
meeting_requested,
confidence,
summary
`;

    const parsed = await generateStructured(prompt, replyAnalysisResultSchema);

    /* ===========================
       UPDATE REPLY
    =========================== */

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

    /* ===========================
       STATE TRANSITION (ATOMIC)
    =========================== */

    const { data: currentCompany } = await supabase
      .from("companies")
      .select("status")
      .eq("id", companyId)
      .maybeSingle();

    const currentStatus = currentCompany?.status ?? company.status;

    await updateCompanyStatus(
      companyId,
      currentStatus,
      "replied",
      company.brand_id,
    );

    /* ===========================
       UNSUBSCRIBE
    =========================== */

    if (parsed.intent === "unsubscribe") {
      const fromMatch = rawMessage.match(/^From:\s.*?<([^>]+)>/im);
      const senderEmail = fromMatch?.[1]?.toLowerCase();

      if (senderEmail) {
        const email = senderEmail;
        const domain = email.split("@")[1];

        const { error: suppressError } = await supabase.from("suppression_list").insert({
          brand_id: brand.id,
          email: email,
          domain: domain,
          reason: "unsubscribe_request",
        });

        if (suppressError) {
          logger.error(
            { companyId, email, error: suppressError.message },
            "Failed to insert suppression record"
          );
        }
      }

      await updateCompanyStatus(
        companyId,
        "replied",
        "closed_lost",
        company.brand_id,
      );
      return success({
        intent: parsed.intent,
        sentiment: parsed.sentiment,
        objection_detected: parsed.objection_detected,
        meeting_requested: parsed.meeting_requested,
        confidence: parsed.confidence,
        summary: parsed.summary,
      });
    }

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

    if (message.includes("parse") || message.includes("invalid")) {
      return terminalFailure(`LLM parsing error: ${message}`);
    }

    return retryableFailure(message);
  }
}
