import pino from "pino";
import { validate as isUUID } from "uuid";
import {
  supabase,
  getBrandProfile,
  resolveBrandByProduct,
  getClientMembers,
  BrandProfile,
} from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import {
  outreachResultSchema,
  success,
  retryableFailure,
  terminalFailure,
  skipped,
  type AgentResult,
} from "./types";
import {
  assembleContext,
  buildContextPreamble,
  buildOutreachPrompt,
  createRunId,
  logAgentTurn,
  structuredError,
} from "../harness";

const AGGREGATOR_NAMES_OUTREACH = new Set([
  "naukri", "indeed", "glassdoor", "linkedin", "upwork", "jooble",
  "simplyhired", "monster", "ziprecruiter", "careerbuilder",
  "flexjobs", "zippia", "apna", "workingnomads",
]);

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
  const runId = createRunId("outreach");
  const startTime = Date.now();

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

    const nameLower = (company.name || "").toLowerCase();
    if ([...AGGREGATOR_NAMES_OUTREACH].some(n => nameLower.includes(n))) {
      logger.warn({ company: company.name }, "Aggregator name matched at outreach stage, skipping");
      return terminalFailure("Aggregator — not a real company");
    }

    const { data: leadMap } = await supabase
      .from("lead_company_map")
      .select("lead_id")
      .eq("company_id", company.id)
      .limit(1)
      .maybeSingle();

    if (!leadMap?.lead_id) {
      logger.warn({ company: company.name }, "No lead associated with company — skipping outreach");
      return skipped("No lead associated with company");
    }

    const { data: lead } = await supabase
      .from("leads")
      .select("email, full_name")
      .eq("id", leadMap.lead_id)
      .maybeSingle();

    const recipientName = lead?.full_name || lead?.email?.split("@")[0] || "there";

    const members = brand.client_id ? await getClientMembers(brand.client_id) : [];
    const senderName = members.find(m => m.role === "owner")?.name
      || members[0]?.name
      || brand.brand_name
      || "Your Name";

    const agentContext = await assembleContext({
      company: {
        id: company.id,
        name: company.name,
        brand_id: company.brand_id,
      },
      brand,
      stage: "outreach",
    });

    const contextPreamble = buildContextPreamble(agentContext, ["similar", "conversion"]);

    const prompt = buildOutreachPrompt({
      senderName,
      brandName: brand.brand_name,
      positioning: brand.positioning ?? "",
      tone: brand.tone ?? "",
      recipientName,
      companyName: company.name ?? "",
      painPoints: research.pain_points,
      contextPreamble: contextPreamble || undefined,
      compaction: agentContext.compaction,
    });

    const parsed = await generateStructured(
      prompt,
      outreachResultSchema,
      brand.llm_temperature ?? 0.2,
      clientId ?? undefined,
    );

    const { error } = await supabase.from("outreach").insert({
      company_id: company.id,
      brand_id: brand.id,
      subject: parsed.subject,
      body: parsed.body,
    });

    if (error?.code === "23505") {
      return success({ subject: parsed.subject, body: parsed.body });
    }

    if (error) {
      logger.error({ error }, "Failed to insert outreach");
      return retryableFailure(`Database error: ${error.message}`);
    }

    logAgentTurn({
      run_id: runId,
      agent_id: "outreach",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: Math.ceil(prompt.length / 4),
      output_tokens: Math.ceil(JSON.stringify(parsed).length / 4),
      tools_called: ["generate_outreach", "save_to_database"],
      tool_latencies_ms: { generate_outreach: Date.now() - startTime },
      tool_errors: [],
      stop_reason: "completed",
      cost_usd: 0,
      context_utilization_pct: 0,
    });

    logger.info(`Draft created → ${company.name}`);
    return success({ subject: parsed.subject, body: parsed.body });
  } catch (err: any) {
    const message = err?.message ?? "Unknown error";
    logger.error(`Outreach failed: ${message}`);

    logAgentTurn({
      run_id: runId,
      agent_id: "outreach",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: 0,
      output_tokens: 0,
      tools_called: [],
      tool_latencies_ms: {},
      tool_errors: [structuredError({ tool: "generate_outreach", message, input: { company: company.name } })],
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
