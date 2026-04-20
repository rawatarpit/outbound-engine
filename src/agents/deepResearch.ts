import axios from "axios";
import { load } from "cheerio";
import pino from "pino";
import { z } from "zod";
import { supabase, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import { sanitizeForPrompt } from "../llm/sanitize";
import {
  AgentResult,
  success,
  retryableFailure,
  terminalFailure,
} from "./types";

interface CompanyInput {
  id: string;
  name?: string | null;
  website?: string | null;
  brand_id?: string | null;
}

const deepResearchSchema = z.object({
  industry: z.string(),
  company_size: z.string(),
  business_model: z.string(),
  pain_points: z.array(z.string()),
  current_solutions: z.array(z.string()),
  buying_signals: z.array(z.string()),
  tech_stack: z.array(z.string()),
  funding_status: z.string(),
  fit_score: z.number().min(0).max(100),
  fit_reasoning: z.string(),
  summary: z.string(),
});

const logger = pino({ level: "info" });

const SCRAPE_TIMEOUT_MS = 15000;

async function scrapeCompanyWebsite(url: string): Promise<string | null> {
  try {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

    const { data } = await axios.get(normalizedUrl, {
      timeout: SCRAPE_TIMEOUT_MS,
      maxRedirects: 3,
      validateStatus: (status) => status < 500,
    });

    if (typeof data !== "string") return null;

    const $ = load(data);
    $("script, style, noscript, header, footer, nav").remove();

    const title = $("title").first().text().trim();
    const paragraphs = $("p")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 50)
      .slice(0, 10);

    const content = [title, ...paragraphs].join("\n\n").slice(0, 10000);
    return content.length > 200 ? content : null;
  } catch {
    return null;
  }
}

export async function runDeepResearchAgent(
  company: CompanyInput,
): Promise<AgentResult<Record<string, unknown>>> {
  if (!company?.website) {
    return terminalFailure("Company website is required");
  }

  if (!company.brand_id) {
    return terminalFailure("Brand ID is required");
  }

  const existing = await supabase
    .from("research")
    .select("id")
    .eq("company_id", company.id)
    .maybeSingle();

  if (existing.data) {
    logger.info(`Research already exists → ${company.name}`);
    return success({ alreadyResearched: true });
  }

  const brand = await getBrandProfile(company.brand_id);
  if (!brand) {
    return terminalFailure(`Brand profile not found: ${company.brand_id}`);
  }
  if (!brand.is_active) {
    return terminalFailure(`Brand is not active: ${brand.brand_name}`);
  }

  const content = await scrapeCompanyWebsite(company.website);
  if (!content) {
    return retryableFailure(`Failed to scrape website: ${company.website}`);
  }

  const prompt = `
You are a senior B2B sales researcher for ${sanitizeForPrompt(brand.brand_name)}.

BRAND CONTEXT:
- Product: ${sanitizeForPrompt(brand.product)}
- Positioning: ${sanitizeForPrompt(brand.positioning ?? "N/A")}
- Core Offer: ${sanitizeForPrompt(brand.core_offer ?? "N/A")}
- Target Audience: ${sanitizeForPrompt(brand.audience ?? "N/A")}

WEBSITE CONTENT:
${sanitizeForPrompt(content)}

Analyze this company thoroughly. Return JSON:
industry, company_size, business_model, pain_points (array), current_solutions (array), 
buying_signals (array), tech_stack (array), funding_status, 
fit_score (0-100), fit_reasoning, summary
`;

  try {
    const parsed = await generateStructured(prompt, deepResearchSchema);

    const { error } = await supabase.from("research").insert({
      company_id: company.id,
      brand_id: company.brand_id,
      industry: parsed.industry,
      size_estimate: parsed.company_size,
      pain_points: parsed.pain_points.join("; "),
      buying_signals: parsed.buying_signals.join("; "),
      automation_maturity: parsed.business_model,
      summary: parsed.summary,
      raw_content: content,
    });

    if (error?.code === "23505") {
      return success({ ...parsed });
    }

    if (error) {
      logger.error({ error }, "Failed to insert research");
      return retryableFailure(`Database error: ${error.message}`);
    }

    logger.info(
      `Deep research completed → ${company.name} (fit: ${parsed.fit_score})`,
    );
    return success({
      ...parsed,
      fitScore: parsed.fit_score,
      fitReasoning: parsed.fit_reasoning,
    });
  } catch (err: any) {
    const message = (err as Error)?.message ?? "Unknown error";
    logger.error(`Deep research failed (${company.name}): ${message}`);

    if (message.includes("parse") || message.includes("invalid")) {
      return terminalFailure(`LLM parsing error: ${message}`);
    }

    return retryableFailure(message);
  }
}
