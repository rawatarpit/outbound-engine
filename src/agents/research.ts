import pino from "pino";
import { supabase, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import { scrapeUrl } from "../core/utils/scraper";
import {
  researchResultSchema,
  success,
  retryableFailure,
  terminalFailure,
  toHarnessResult,
  AgentResultStatus,
  type AgentResult,
} from "./types";
import {
  assembleContext,
  buildContextPreamble,
  buildResearchPrompt,
  createRunId,
  logAgentTurn,
  withRetry,
  structuredError,
} from "../harness";

const logger = pino({ level: "info" });

interface CompanyInput {
  id: string;
  name?: string | null;
  website?: string | null;
  brand_id?: string | null;
}

const AGGREGATOR_DOMAINS_RESEARCH = new Set([
  "flexjobs.com", "zippia.com", "apna.co", "workingnomads.com",
  "virtualvocations.com", "totaljobs.com", "shine.com",
  "internshala.com", "salesdevjobs.com", "iimjobs.com",
  "salesstaffingagency.com", "recruiters.com", "nspdmall.com",
  "monster.com", "careerbuilder.com", "dice.com", "indeed.com",
  "glassdoor.com", "simplyhired.com", "ziprecruiter.com",
  "jobstreet.com", "naukri.com", "jooble.com",
]);

const AGGREGATOR_NAMES_RESEARCH = new Set([
  "naukri", "indeed", "glassdoor", "linkedin", "upwork", "jooble",
  "simplyhired", "monster", "ziprecruiter", "careerbuilder",
  "flexjobs", "zippia", "apna", "workingnomads",
]);

export async function runResearchAgent(
  company: CompanyInput,
): Promise<AgentResult<boolean>> {
  const runId = createRunId("research");
  const startTime = Date.now();

  if (!company?.website) {
    return terminalFailure("Company website is required");
  }

  const siteDomain = company.website.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (AGGREGATOR_DOMAINS_RESEARCH.has(siteDomain)) {
    logger.warn({ website: company.website, company: company.name }, "Aggregator domain, skipping research");
    return terminalFailure("Aggregator domain — not a real company");
  }

  const nameMatch = (company.name || "").toLowerCase();
  if ([...AGGREGATOR_NAMES_RESEARCH].some(n => nameMatch.includes(n))) {
    logger.warn({ company: company.name }, "Aggregator name match, skipping research");
    return terminalFailure("Aggregator name — not a real company");
  }

  const { data: existing } = await supabase
    .from("research")
    .select("id")
    .eq("company_id", company.id)
    .maybeSingle();

  if (existing) {
    logger.info(`Research already exists → ${company.name}`);
    return success(true);
  }

  const content = await withRetry(
    () => scrapeUrl(company.website!, 8000).then(r => {
      if (!r) throw new Error(`Failed to scrape website: ${company.website}`);
      return r;
    }),
    { maxAttempts: 2, baseDelayMs: 2000, backoffFactor: 2 },
  ).catch(() => null);

  if (!content) {
    return retryableFailure(`Failed to scrape website: ${company.website}`);
  }

  const brand = await getBrandProfile(company.brand_id ?? "");

  if (!brand) {
    return terminalFailure(`Brand profile not found: ${company.brand_id}`);
  }

  if (!brand.is_active) {
    return terminalFailure(`Brand is not active: ${brand.brand_name}`);
  }

  const agentContext = await assembleContext({
    company: {
      id: company.id,
      name: company.name,
      domain: siteDomain,
      brand_id: company.brand_id,
    },
    brand,
    stage: "research",
  });

  const contextPreamble = buildContextPreamble(agentContext, ["similar", "outcomes", "enrichment", "conversion"]);

  const prompt = buildResearchPrompt({
    brandName: brand.brand_name,
    positioning: brand.positioning ?? "",
    coreOffer: brand.core_offer ?? "",
    audience: brand.audience ?? "",
    content,
    contextPreamble: contextPreamble || undefined,
    compaction: agentContext.compaction,
  });

  try {
    const parsed = await generateStructured(prompt, researchResultSchema, undefined, brand.client_id ?? undefined);

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

    await new Promise(r => setTimeout(r, 2500));

    logAgentTurn({
      run_id: runId,
      agent_id: "research",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: Math.ceil(prompt.length / 4),
      output_tokens: Math.ceil(JSON.stringify(parsed).length / 4),
      tools_called: ["scrape_website", "generate_research", "save_to_database"],
      tool_latencies_ms: { scrape_website: Date.now() - startTime },
      tool_errors: [],
      stop_reason: "completed",
      cost_usd: 0,
      context_utilization_pct: 0,
    });

    logger.info(`Research completed → ${company.name}`);
    return success(true);
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    logger.error(`Research failed (${company.name}): ${message}`);

    logAgentTurn({
      run_id: runId,
      agent_id: "research",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: Math.ceil(prompt.length / 4),
      output_tokens: 0,
      tools_called: ["scrape_website"],
      tool_latencies_ms: {},
      tool_errors: [structuredError({ tool: "generate_research", message, input: { company: company.name } })],
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
