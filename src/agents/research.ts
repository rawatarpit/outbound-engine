import axios from "axios";
import { load } from "cheerio";
import pino from "pino";
import { z } from "zod";
import { supabase, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import { sanitizeForPrompt } from "../llm/sanitize";
import {
  AgentResult,
  researchResultSchema,
  success,
  retryableFailure,
  terminalFailure,
  skipped,
} from "./types";

interface CompanyInput {
  id: string;
  name?: string | null;
  website?: string | null;
  brand_id?: string | null;
}

const logger = pino({ level: "info" });

/* =========================================================
   SCHEMA
========================================================= */

const researchSchema = z.object({
  industry: z.string(),
  size_estimate: z.string(),
  pain_points: z.string(),
  buying_signals: z.string(),
  automation_maturity: z.string(),
  sponsorship_potential: z.boolean(),
  summary: z.string(),
});

/* =========================================================
   WEBSITE SCRAPER
========================================================= */

async function scrapeWebsite(url: string): Promise<string | null> {
  try {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

    const { data } = await axios.get(normalizedUrl, {
      timeout: 10000,
      maxRedirects: 3,
      validateStatus: (status) => status < 500,
    });

    if (typeof data !== "string") return null;

    const $ = load(data);

    $("script, style, noscript").remove();

    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000);

    return text.length > 200 ? text : null;
  } catch {
    return null;
  }
}

/* =========================================================
   RESEARCH AGENT
========================================================= */

export async function runResearchAgent(
  company: CompanyInput,
): Promise<AgentResult<boolean>> {
  if (!company?.website) {
    return terminalFailure("Company website is required");
  }

  /* =============================
     IDEMPOTENCY CHECK
  ============================= */

  const { data: existing } = await supabase
    .from("research")
    .select("id")
    .eq("company_id", company.id)
    .maybeSingle();

  if (existing) {
    logger.info(`Research already exists → ${company.name}`);
    return success(true);
  }

  /* =============================
     SCRAPE WEBSITE
  ============================= */

  const content = await scrapeWebsite(company.website);
  if (!content) {
    logger.warn(`Scrape failed → ${company.website}`);
    return retryableFailure(`Failed to scrape website: ${company.website}`);
  }

  /* =============================
     LOAD BRAND PROFILE
  ============================= */

  const brand = await getBrandProfile(company.brand_id ?? "");

  if (!brand) {
    logger.error(`Brand profile missing → ${company.brand_id}`);
    return terminalFailure(`Brand profile not found: ${company.brand_id}`);
  }

  if (!brand.is_active) {
    logger.warn(`Brand inactive → ${company.brand_id}`);
    return terminalFailure(`Brand is not active: ${brand.brand_name}`);
  }

  /* =============================
     BUILD PROMPT
  ============================= */

  const prompt = `
You are conducting strategic research for ${sanitizeForPrompt(brand.brand_name)}.

Brand Positioning:
${sanitizeForPrompt(brand.positioning ?? "N/A")}

Core Offer:
${sanitizeForPrompt(brand.core_offer ?? "N/A")}

Target Audience:
${sanitizeForPrompt(brand.audience ?? "N/A")}

Analyze this company website content.

Return JSON:
industry,
size_estimate,
pain_points,
buying_signals,
automation_maturity,
sponsorship_potential,
summary

Content:
${sanitizeForPrompt(content)}
`;

  /* =============================
     LLM EXECUTION
  ============================= */

  try {
    const parsed = await generateStructured(prompt, researchResultSchema);

    /* =============================
       INSERT RESEARCH
     ============================= */

    const { error } = await supabase.from("research").insert({
      company_id: company.id,
      brand_id: company.brand_id,
      industry: parsed.industry,
      size_estimate: parsed.size_estimate,
      pain_points: parsed.pain_points,
      buying_signals: parsed.buying_signals,
      automation_maturity: parsed.automation_maturity,
      sponsorship_potential: parsed.sponsorship_potential,
      summary: parsed.summary,
      raw_content: content,
    });

    if (error?.code === "23505") {
      return success(true);
    }

    if (error) {
      logger.error({ error }, "Failed to insert research");
      return retryableFailure(`Database error: ${error.message}`);
    }

    logger.info(`Research completed → ${company.name}`);
    return success(true);
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    logger.error(`Research failed (${company.name}): ${message}`);

    if (message.includes("parse") || message.includes("invalid")) {
      return terminalFailure(`LLM parsing error: ${message}`);
    }

    return retryableFailure(message);
  }
}
