import pino from "pino";
import { supabase, getBrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import {
  negotiationResultSchema,
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
const MIN_CONFIDENCE = 0.75;

export async function runNegotiationAgent(
  companyId: string,
): Promise<AgentResult<{ draft: string }>> {
  const runId = createRunId("negotiation");
  const startTime = Date.now();

  try {
    if (!companyId) {
      return terminalFailure("Company ID is required");
    }

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

    const { data: existingDraft } = await supabase
      .from("negotiation_drafts")
      .select("id")
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingDraft) {
      logger.info(`Negotiation already exists → ${company.name}`);
      return skipped("Negotiation draft already exists");
    }

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

    const agentContext = await assembleContext({
      company: { id: companyId, name: company.name, brand_id: company.brand_id },
      brand,
      stage: "negotiation",
    });
    const compactionBlock = agentContext.compaction
      ? `${agentContext.compaction}\n\n`
      : "";

    const prompt = `${compactionBlock}You are the founder of ${brand.brand_name}.

Brand Positioning:
${brand.positioning ?? "N/A"}

Negotiation Style:
${brand.negotiation_style ?? "Professional and direct"}

Previous Email:
${outreach.body}

Client Reply:
${reply.raw_content}

Respond with a professional negotiation follow-up.

Return JSON:
draft
`;

    const parsed = await generateStructured(prompt, negotiationResultSchema, undefined, brand.client_id ?? undefined);

    if (!parsed?.draft) {
      return terminalFailure("LLM returned empty draft");
    }

    const { error } = await supabase.from("negotiation_drafts").insert({
      company_id: companyId,
      brand_id: brand.id,
      content: parsed.draft,
    });

    if (error) {
      logger.error({ error }, "Failed to insert negotiation draft");
      return retryableFailure(`Database error: ${error.message}`);
    }

    logAgentTurn({
      run_id: runId,
      agent_id: "negotiation",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: Math.ceil(prompt.length / 4),
      output_tokens: Math.ceil(JSON.stringify(parsed).length / 4),
      tools_called: ["generate_negotiation", "save_to_database"],
      tool_latencies_ms: { generate_negotiation: Date.now() - startTime },
      tool_errors: [],
      stop_reason: "completed",
      cost_usd: 0,
      context_utilization_pct: 0,
    });

    logger.info(`Negotiation draft created → ${company.name}`);
    return success({ draft: parsed.draft });
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    logger.error({ err: message }, "Negotiation failed");

    logAgentTurn({
      run_id: runId,
      agent_id: "negotiation",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: 0,
      output_tokens: 0,
      tools_called: [],
      tool_latencies_ms: {},
      tool_errors: [structuredError({ tool: "generate_negotiation", message, input: { companyId } })],
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
