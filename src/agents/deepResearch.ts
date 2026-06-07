import pino from "pino";
import { z } from "zod";
import { supabase, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import { scrapeUrl } from "../core/utils/scraper";
import {
  success,
  retryableFailure,
  terminalFailure,
  type AgentResult,
} from "./types";
import {
  createRunId,
  logAgentTurn,
  structuredError,
  withRetry,
} from "../harness";

const deepResearchSchema = z.object({
  industry: z.string().catch(""),
  company_size: z.string().catch(""),
  business_model: z.string().catch(""),
  pain_points: z.array(z.string()).catch([]),
  current_solutions: z.array(z.string()).catch([]),
  buying_signals: z.array(z.string()).catch([]),
  tech_stack: z.array(z.string()).catch([]),
  funding_status: z.string().catch(""),
  fit_score: z.number().min(0).max(100).catch(0),
  fit_reasoning: z.string().catch(""),
  summary: z.string().catch(""),
});

const logger = pino({ level: "info" });

interface CompanyInput {
  id: string;
  name?: string | null;
  website?: string | null;
  brand_id?: string | null;
}

export async function runDeepResearchAgent(
  company: CompanyInput,
): Promise<AgentResult<Record<string, unknown>>> {
  const runId = createRunId("deep-research");
  const startTime = Date.now();

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

  const content = await withRetry(
    () => scrapeUrl(company.website!, 10000).then(r => {
      if (!r) throw new Error(`Failed to scrape website: ${company.website}`);
      return r;
    }),
    { maxAttempts: 2, baseDelayMs: 2000, backoffFactor: 2 },
  ).catch(() => null);

  if (!content) {
    return retryableFailure(`Failed to scrape website: ${company.website}`);
  }

  const prompt = `
You are a senior B2B sales researcher for ${brand.brand_name}.

BRAND CONTEXT:
- Product: ${brand.product}
- Positioning: ${brand.positioning ?? "N/A"}
- Core Offer: ${brand.core_offer ?? "N/A"}
- Target Audience: ${brand.audience ?? "N/A"}

WEBSITE CONTENT:
${content}

Analyze this company thoroughly. Return JSON:
industry, company_size, business_model, pain_points (array), current_solutions (array), 
buying_signals (array), tech_stack (array), funding_status, 
fit_score (0-100), fit_reasoning, summary
`;

  try {
    const parsed = await generateStructured(prompt, deepResearchSchema, undefined, brand.client_id ?? undefined);

    const { error } = await supabase.from("research").insert({
      company_id: company.id,
      brand_id: company.brand_id,
      industry: parsed.industry,
      size_estimate: parsed.company_size,
      pain_points: (parsed.pain_points as string[]).join("; "),
      buying_signals: (parsed.buying_signals as string[]).join("; "),
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

    logAgentTurn({
      run_id: runId,
      agent_id: "deep-research",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: Math.ceil(prompt.length / 4),
      output_tokens: Math.ceil(JSON.stringify(parsed).length / 4),
      tools_called: ["scrape_website", "generate_deep_research", "save_to_database"],
      tool_latencies_ms: { deep_research: Date.now() - startTime },
      tool_errors: [],
      stop_reason: "completed",
      cost_usd: 0,
      context_utilization_pct: 0,
    });

    logger.info(`Deep research completed → ${company.name} (fit: ${parsed.fit_score})`);
    return success({
      ...parsed,
      fitScore: parsed.fit_score,
      fitReasoning: parsed.fit_reasoning,
    });
  } catch (err: any) {
    const message = (err as Error)?.message ?? "Unknown error";
    logger.error(`Deep research failed (${company.name}): ${message}`);

    logAgentTurn({
      run_id: runId,
      agent_id: "deep-research",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: Math.ceil(prompt.length / 4),
      output_tokens: 0,
      tools_called: ["scrape_website"],
      tool_latencies_ms: {},
      tool_errors: [structuredError({ tool: "generate_deep_research", message, input: { company: company.name } })],
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
