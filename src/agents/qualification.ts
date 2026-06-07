import pino from "pino";
import { supabase, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import {
  qualificationResultSchema,
  success,
  retryableFailure,
  terminalFailure,
  skipped,
  type AgentResult,
} from "./types";
import {
  assembleContext,
  buildContextPreamble,
  buildQualificationPrompt,
  createRunId,
  logAgentTurn,
  structuredError,
} from "../harness";

const logger = pino({ level: "info" });

interface CompanyInput {
  id: string;
  name?: string | null;
  brand_id?: string | null;
}

export async function runQualificationAgent(
  company: CompanyInput,
): Promise<AgentResult<{ fitScore: number }>> {
  const runId = createRunId("qualification");
  const startTime = Date.now();

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

    const painPoints = Array.isArray(research.pain_points)
      ? research.pain_points.join(", ")
      : String(research.pain_points ?? "");
    const buyingSignals = Array.isArray(research.buying_signals)
      ? research.buying_signals.join(", ")
      : String(research.buying_signals ?? "");

    const agentContext = await assembleContext({
      company: {
        id: company.id,
        name: company.name,
        brand_id: company.brand_id,
      },
      brand,
      stage: "qualification",
    });

    const contextPreamble = buildContextPreamble(agentContext, ["sources", "outcomes", "conversion"]);

    const prompt = buildQualificationPrompt({
      brandName: brand.brand_name,
      coreOffer: brand.core_offer ?? "",
      industry: research.industry,
      painPoints,
      automationMaturity: research.automation_maturity,
      buyingSignals,
      contextPreamble: contextPreamble || undefined,
      compaction: agentContext.compaction,
    });

    const parsed = await generateStructured(prompt, qualificationResultSchema, undefined, brand.client_id ?? undefined);

    const { error } = await supabase.from("qualification").insert({
      company_id: company.id,
      brand_id: company.brand_id,
      fit_score: parsed.fit_score,
      reasoning: parsed.reasoning,
      confidence: Math.round(parsed.confidence * 100),
    });

    if (error?.code === "23505") {
      return success({ fitScore: parsed.fit_score });
    }

    if (error) {
      logger.error({ error }, "Failed to insert qualification");
      return retryableFailure(`Database error: ${error.message}`);
    }

    logAgentTurn({
      run_id: runId,
      agent_id: "qualification",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: Math.ceil(prompt.length / 4),
      output_tokens: Math.ceil(JSON.stringify(parsed).length / 4),
      tools_called: ["score_qualification", "save_to_database"],
      tool_latencies_ms: { score_qualification: Date.now() - startTime },
      tool_errors: [],
      stop_reason: "completed",
      cost_usd: 0,
      context_utilization_pct: 0,
    });

    return success({ fitScore: parsed.fit_score });
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    logger.error({ err: message }, "Qualification failed");

    logAgentTurn({
      run_id: runId,
      agent_id: "qualification",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: 0,
      output_tokens: 0,
      tools_called: [],
      tool_latencies_ms: {},
      tool_errors: [structuredError({ tool: "score_qualification", message, input: { company: company.name } })],
      stop_reason: "error",
      cost_usd: 0,
      context_utilization_pct: 0,
    });

    if (err?.message?.includes("parse") || err?.message?.includes("invalid")) {
      return terminalFailure(`LLM parsing error: ${message}`);
    }

    return retryableFailure(message);
  }
}
