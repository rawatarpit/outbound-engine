import pino from "pino";
import { BrandProfile } from "../db/supabase";
import { generateStructured } from "../llm/ollama";
import { z } from "zod";
import {
  ReasonerOutput, ReasonedToolCall, PipelineState, UserPreferences,
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

const ReasonerSchema = z.object({
  reasoning: z.string(),
  tool_calls: z.array(z.object({
    name: z.string(),
    input: z.record(z.unknown()),
    parallel_group: z.string().nullable(),
    reason: z.string(),
    depends_on: z.array(z.string()),
  })),
  is_final: z.boolean(),
});

function buildHardcodedPlan(intent: string, parameters: Record<string, unknown>, state: PipelineState, preferences: UserPreferences): ReasonedToolCall[] {
  const plan = TOOL_PLANS[intent];
  if (!plan) return [];

  // Run each step only once per batch
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

async function buildLLMPlan(input: ReasonerInput): Promise<ReasonedToolCall[] | null> {
  const prompt = `You are an AI outbound sales agent. Decide which tools to call next based on the user's message and current state.

Available tools:
- discover_leads: Search web+news for companies matching criteria. Input: search_queries[], max_leads, offset. Output: leads[{name, domain, summary}]
- research_leads: Research companies via website scrape + multi-source web search. Input: max_leads. Output: researched[{company_id, status}]
- enrich_leads: Find contacts (emails, names, titles, LinkedIn, phone) for companies via multi-source search. Input: max_leads. Output: contacts[{full_name, email, title}]
- qualify_leads: Score companies against brand ICP. Input: max_leads. Output: qualified[{company_id, data:{fitScore}}]
- draft_emails: Generate outreach emails from research+contacts. Input: max_leads. Output: drafts[{subject, body}]
- send_emails: Send drafted emails via brand's provider. Input: max_leads. Output: sent[{status}]
- get_pipeline: Show current pipeline status. Output: summary, companies[]
- search_web: General web search. Input: query. Output: results[{title, url, snippet}]

Current pipeline state:
- Stage: ${input.state.stage}
- Leads found: ${input.state.leads.length}
- Researched: ${input.state.researched.length}
- Contacts found: ${input.state.enriched.length}
- Qualified: ${input.state.qualified.length}
- Drafts: ${input.state.drafts.length}
- Sent: ${input.state.sent.length}
- Batch count: ${input.preferences.batchCount}

User preferences:
- Liked companies: ${input.preferences.likedCompanyIds.length ? input.preferences.likedCompanyIds.join(", ") : "none yet"}
- Disliked companies: ${input.preferences.dislikedCompanyIds.length ? input.preferences.dislikedCompanyIds.join(", ") : "none yet"}
- Preferred keywords: ${input.preferences.preferredKeywords.join(", ") || "none"}
- Keywords to avoid: ${input.preferences.avoidKeywords.join(", ") || "none"}

User message: "${input.userMessage}"

Response with JSON:
{
  "reasoning": "Explain your thought process",
  "tool_calls": [
    {
      "name": "tool_name",
      "input": { },
      "parallel_group": "A or B or null",
      "reason": "Why this tool",
      "depends_on": []
    }
  ],
  "is_final": false
}

Rules:
- If the user's intent is clear, call the matching tool
- Tools with same parallel_group run concurrently
- If user wants more leads after a batch, include offset in discover_leads input
- If user mentioned liking/disliking companies, adjust preferences
- is_final=true only when no more tools need to run (chat intent or done)`;

  try {
    const parsed = await generateStructured(prompt, ReasonerSchema, 0.3, input.brand.client_id ?? undefined, 500, undefined, 60000);
    return parsed.tool_calls.map(tc => ({
      name: tc.name,
      input: { ...tc.input, brand_id: input.brand.id, client_id: input.brand.client_id ?? undefined },
      parallel_group: tc.parallel_group || null,
      reason: tc.reason,
      depends_on: tc.depends_on,
    }));
  } catch {
    logger.warn("LLM reasoning failed, using hardcoded plan");
    return null;
  }
}

export async function reasonNextTools(input: ReasonerInput): Promise<ReasonerOutput> {
  const start = Date.now();

  // Try LLM path first (15s timeout — 8B should handle this fast)
  const llmCalls = await buildLLMPlan(input);
  if (llmCalls && llmCalls.length > 0) {
    return {
      toolCalls: llmCalls,
      isFinal: false,
      reasoning: "LLM-driven tool selection",
    };
  }

  // Hardcoded fallback
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
