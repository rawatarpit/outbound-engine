import pino from "pino";
import { z } from "zod";
import { validate as isUUID } from "uuid";
import {
  supabase,
  getBrandProfile,
  resolveBrandByProduct,
  BrandProfile,
} from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import { sanitizeForPrompt } from "../llm/sanitize";
import {
  AgentResult,
  outreachResultSchema,
  success,
  retryableFailure,
  terminalFailure,
  skipped,
} from "./types";

interface CompanyInput {
  id: string;
  name?: string | null;
  brand_id?: string | null;
  client_id?: string | null;
}

const logger = pino({ level: "info" });

export async function runOutreachAgent(
  company: CompanyInput,
): Promise<AgentResult<{ subject: string; body: string }>> {
  try {
    if (!company?.id) {
      return terminalFailure("Company ID is required");
    }

    if (!company.brand_id) {
      return terminalFailure("No brand assigned to company");
    }

    let brandId = company.brand_id;
    if (brandId && !isUUID(brandId)) {
      const resolvedId = await resolveBrandByProduct(brandId);
      if (!resolvedId) {
        return terminalFailure(`Brand profile not found: ${brandId}`);
      }
      brandId = resolvedId;
    }

    const brand = await getBrandProfile(brandId);
    if (!brand) {
      return terminalFailure(`Brand profile not found: ${company.brand_id}`);
    }
    if (!brand.is_active) {
      return terminalFailure(`Brand is not active: ${brand.brand_name}`);
    }

    // Get client_id from brand or company
    const clientId =
      company.client_id ??
      (brand as BrandProfile & { client_id?: string }).client_id;

    const { data: existingDraft } = await supabase
      .from("outreach")
      .select("id")
      .eq("company_id", company.id)
      .eq("status", "draft")
      .maybeSingle();

    if (existingDraft) {
      logger.info(`Draft exists → ${company.name}`);
      return skipped("Draft already exists");
    }

    const { data: research } = await supabase
      .from("research")
      .select("*")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .maybeSingle();

    if (!research) {
      return skipped("No research data available");
    }

    const prompt = `
You are the founder of ${sanitizeForPrompt(brand.brand_name)}.

Brand Positioning:
${sanitizeForPrompt(brand.positioning ?? "N/A")}

Tone:
${sanitizeForPrompt(brand.tone ?? "N/A")}

Company: ${sanitizeForPrompt(company.name)}
Pain Points: ${sanitizeForPrompt(research.pain_points)}

Write a cold email:
- Under 150 words
- Clear CTA
- Human tone

Return JSON:
subject,
body
`;

    const parsed = await generateStructured(
      prompt,
      outreachResultSchema,
      brand.llm_temperature ?? 0.2,
      clientId ?? undefined,
    );

    const { data: leadMap } = await supabase
      .from("lead_company_map")
      .select("lead_id")
      .eq("company_id", company.id)
      .limit(1)
      .maybeSingle();

    if (!leadMap?.lead_id) {
      return terminalFailure("No lead associated with company");
    }

    const { error } = await supabase.from("outreach").insert({
      company_id: company.id,
      brand_id: brand.id,
      lead_id: leadMap?.lead_id,
      subject: parsed.subject,
      body: parsed.body,
      status: "draft",
    });

    if (error?.code === "23505") {
      return success({ subject: parsed.subject, body: parsed.body });
    }

    if (error) {
      logger.error({ error }, "Failed to insert outreach");
      return retryableFailure(`Database error: ${error.message}`);
    }

    logger.info(`Draft created → ${company.name}`);
    return success({ subject: parsed.subject, body: parsed.body });
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    logger.error(`Outreach failed: ${message}`);

    if (message.includes("parse") || message.includes("invalid")) {
      return terminalFailure(`LLM parsing error: ${message}`);
    }

    return retryableFailure(message);
  }
}
