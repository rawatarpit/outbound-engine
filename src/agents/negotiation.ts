import pino from "pino";
import { z } from "zod";
import { supabase, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import { sanitizeForPrompt } from "../llm/sanitize";
import {
  AgentResult,
  negotiationResultSchema,
  success,
  retryableFailure,
  terminalFailure,
  skipped,
} from "./types";

const logger = pino({ level: "info" });

const MIN_CONFIDENCE = 0.75;

export async function runNegotiationAgent(
  companyId: string,
): Promise<AgentResult<{ draft: string }>> {
  try {
    if (!companyId) {
      return terminalFailure("Company ID is required");
    }

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
       IDEMPOTENCY CHECK
    =========================== */

    const { data: existingDraft } = await supabase
      .from("negotiation_drafts")
      .select("id")
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingDraft) {
      logger.info(`Negotiation already exists → ${company.name}`);
      return skipped("Negotiation draft already exists");
    }

    /* ===========================
       LOAD OUTREACH + REPLY
    =========================== */

    const { data: outreach } = await supabase
      .from("outreach")
      .select("body")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .maybeSingle();

    const { data: reply } = await supabase
      .from("replies")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .maybeSingle();

    if (!outreach || !reply) {
      return skipped("No outreach or reply data available");
    }

    if (reply.intent !== "high") {
      return skipped("Reply intent is not high priority");
    }

    if (!reply.confidence || reply.confidence < MIN_CONFIDENCE) {
      return skipped(`Reply confidence below threshold: ${reply.confidence}`);
    }

    if (!reply.raw_content) {
      return skipped("No raw reply content available");
    }

    /* ===========================
       LLM PROMPT
    =========================== */

    const prompt = `
You are the founder of ${sanitizeForPrompt(brand.brand_name)}.

Brand Positioning:
${sanitizeForPrompt(brand.positioning ?? "N/A")}

Negotiation Style:
${sanitizeForPrompt(brand.negotiation_style ?? "Professional and direct")}

Previous Email:
${sanitizeForPrompt(outreach.body)}

Client Reply:
${sanitizeForPrompt(reply.raw_content)}

Respond with a professional negotiation follow-up.

Return JSON:
draft
`;

    const parsed = await generateStructured(prompt, negotiationResultSchema);

    if (!parsed?.draft) {
      return terminalFailure("LLM returned empty draft");
    }

    /* ===========================
       INSERT DRAFT
    =========================== */

    const { error } = await supabase.from("negotiation_drafts").insert({
      company_id: companyId,
      brand_id: brand.id,
      content: parsed.draft,
    });

    if (error) {
      logger.error({ error }, "Failed to insert negotiation draft");
      return retryableFailure(`Database error: ${error.message}`);
    }

    logger.info(`Negotiation draft created → ${company.name}`);
    return success({ draft: parsed.draft });
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    logger.error({ err: message }, "Negotiation failed");

    if (message.includes("parse") || message.includes("invalid")) {
      return terminalFailure(`LLM parsing error: ${message}`);
    }

    return retryableFailure(message);
  }
}
