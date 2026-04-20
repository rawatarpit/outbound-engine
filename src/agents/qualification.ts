import pino from "pino";
import { z } from "zod";
import { supabase, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import { sanitizeForPrompt } from "../llm/sanitize";
import {
  AgentResult,
  AgentResultStatus,
  qualificationResultSchema,
  success,
  retryableFailure,
  terminalFailure,
  skipped,
} from "./types";

interface CompanyInput {
  id: string;
  name?: string | null;
  brand_id?: string | null;
}

const logger = pino({ level: "info" });

export async function runQualificationAgent(
  company: CompanyInput,
): Promise<AgentResult<{ fitScore: number }>> {
  try {
    if (!company?.id) {
      return terminalFailure("Company ID is required");
    }

    const { data: existing } = await supabase
      .from("qualification")
      .select("id, fit_score")
      .eq("company_id", company.id)
      .maybeSingle();

    if (existing) {
      logger.info(`Qualification exists → ${company.name}`);
      if (existing.fit_score !== null) {
        return success({ fitScore: existing.fit_score });
      }
      return terminalFailure("Existing qualification has null fit_score");
    }

    const { data: research } = await supabase
      .from("research")
      .select("*")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .maybeSingle();

    if (!research) {
      return skipped("No research data available for company");
    }

    const brand = await getBrandProfile(company.brand_id);
    if (!brand) {
      return terminalFailure(`Brand profile not found: ${company.brand_id}`);
    }
    if (!brand.is_active) {
      return terminalFailure(`Brand is not active: ${brand.brand_name}`);
    }

    const prompt = `
You are qualifying a lead for ${sanitizeForPrompt(brand.brand_name)}.

Brand Offer:
${sanitizeForPrompt(brand.core_offer ?? "N/A")}

Industry: ${sanitizeForPrompt(research.industry)}
Pain Points: ${sanitizeForPrompt(research.pain_points)}
Automation Maturity: ${sanitizeForPrompt(research.automation_maturity)}
Buying Signals: ${sanitizeForPrompt(research.buying_signals)}

Return JSON:
fit_score (0-100),
reasoning,
confidence
`;

    const parsed = await generateStructured(prompt, qualificationResultSchema);

    const { error } = await supabase.from("qualification").insert({
      company_id: company.id,
      fit_score: parsed.fit_score,
      recommended_product: company.brand_id,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
    });

    if (error?.code === "23505") {
      return success({ fitScore: parsed.fit_score });
    }

    if (error) {
      logger.error({ error }, "Failed to insert qualification");
      return retryableFailure(`Database error: ${error.message}`);
    }

    return success({ fitScore: parsed.fit_score });
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    logger.error({ err: message }, "Qualification failed");

    if (err?.message?.includes("parse") || err?.message?.includes("invalid")) {
      return terminalFailure(`LLM parsing error: ${message}`);
    }

    return retryableFailure(message);
  }
}
