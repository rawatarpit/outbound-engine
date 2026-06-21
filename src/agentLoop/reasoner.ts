import pino from "pino";
import { BrandProfile } from "../db/supabase";
import {
  ReasonerOutput, PipelineState, UserPreferences,
} from "../harness/types";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

interface ReasonerInput {
  intent: string;
  parameters: Record<string, unknown>;
  state: PipelineState;
  preferences: UserPreferences;
  brand: BrandProfile;
  userMessage: string;
}

const TOOL_PLANS: Record<string, { tools: Array<{ name: string; group: string; depends: string[] }> }> = {
  discover: {
    tools: [{ name: "discover_leads", group: "A", depends: [] }],
  },
  research: {
    tools: [{ name: "research_leads", group: "A", depends: [] }],
  },
  enrich: {
    tools: [{ name: "enrich_leads", group: "A", depends: [] }],
  },
  qualify: {
    tools: [{ name: "qualify_leads", group: "A", depends: [] }],
  },
  outreach: {
    tools: [
      { name: "draft_emails", group: "A", depends: [] },
      { name: "send_emails", group: "B", depends: ["draft_emails"] },
    ],
  },
  send: {
    tools: [{ name: "send_emails", group: "A", depends: [] }],
  },
  pipeline: {
    tools: [{ name: "get_pipeline", group: "A", depends: [] }],
  },
  analyze: {
    tools: [{ name: "analyze_reply", group: "A", depends: [] }],
  },
  chat: {
    tools: [],
  },
};

function buildHardcodedPlan(intent: string, parameters: Record<string, unknown>, state: PipelineState, preferences: UserPreferences) {
  const plan = TOOL_PLANS[intent];
  if (!plan) return [];

  // Run discover only once per batch
  if (intent === "discover" && state.leads.length > 0) {
    return [];
  }
  if (intent === "research" && state.researched.length > 0) {
    return [];
  }
  if (intent === "enrich" && state.enriched.length > 0) {
    return [];
  }
  if (intent === "qualify" && state.qualified.length > 0) {
    return [];
  }

  return plan.tools.map(t => {
    const input: Record<string, unknown> = {};

    if (t.name === "discover_leads") {
      input.search_queries = parameters.search_queries || [];
      input.max_leads = parameters.max_leads || (parameters.lead_count as number) || 10;
      input.offset = state.leads.length;
      input.location = parameters.location;
      input.industry = parameters.industry;
      if (preferences.batchCount > 0 || state.leads.length > 0) {
        input.offset = state.leads.length;
      }
    }

    if (t.name === "research_leads" || t.name === "enrich_leads" || t.name === "qualify_leads" || t.name === "draft_emails" || t.name === "send_emails") {
      input.max_leads = parameters.max_leads || (parameters.lead_count as number) || 10;
    }

    return {
      name: t.name,
      input,
      parallel_group: t.group,
      reason: `Executing ${t.name} for intent "${intent}"`,
      depends_on: t.depends,
    };
  });
}

export async function reasonNextTools(input: ReasonerInput): Promise<ReasonerOutput> {
  const start = Date.now();

  // Skip LLM reasoner (times out at 30s for complex prompts) and use hardcoded plan directly
  const hardcoded = buildHardcodedPlan(input.intent, input.parameters, input.state, input.preferences);
  const isFinal = hardcoded.length === 0;

  logger.info({ intent: input.intent, toolCount: hardcoded.length, ms: Date.now() - start }, "Hardcoded plan used");

  return {
    toolCalls: hardcoded.map(tc => ({
      ...tc,
      input: { ...tc.input, brand_id: input.brand.id, client_id: input.brand.client_id ?? undefined },
    })),
    isFinal,
  };
}
