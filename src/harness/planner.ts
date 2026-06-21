import pino from "pino";
import { z } from "zod";
import { generateStructured } from "../llm/ollama";
import { BrandProfile } from "../db/supabase";
import { OrchestratorConfig } from "../config/reliability";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const PlannerStepSchema = z.object({
  tool: z.string(),
  input: z.record(z.unknown()),
  dependsOn: z.array(z.number()),
});

const PlannerOutputSchema = z.object({
  steps: z.array(PlannerStepSchema).max(2),
  searchQueries: z.array(z.string()).optional(),
  intentDescription: z.string().optional(),
});

const plannerCache = new Map<string, { result: z.infer<typeof PlannerOutputSchema>; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

interface PlannerInput {
  intent: string;
  parameters: Record<string, unknown>;
  brand: BrandProfile;
  previousSearchQueries?: string[];
  userMessage?: string;
}

const TOOL_REGISTRY_DESCRIPTION = `Available tools:
1. discover_leads: Find NEW leads/prospects by searching the web, social, job boards, news, Eventbrite, Meetup. Use for "find leads" intent. Input: { brand_id, client_id?, limit, search_queries?: string[] }.
2. research_leads: Research/analyze companies ALREADY in the pipeline. Scrape their websites, look up their tech stack. Use for "research" intent. Input: { brand_id, client_id?, max_leads, query? }.
3. enrich_leads: Find contact details (emails, names, titles, LinkedIn) for leads. Use for "find contacts" intent. Input: { brand_id, client_id?, max_leads }.
4. qualify_leads: Score/qualify leads against ideal customer profile. Use for "qualify" intent. Input: { brand_id, client_id?, max_leads, query? }.
5. draft_emails: Generate personalized email drafts. Use for "draft/write" intent. Input: { brand_id, client_id?, max_leads, query? }.
6. send_emails: Send approved drafts. Use for "send" intent. Input: { brand_id, client_id?, draft_ids? }.
7. get_pipeline: Show pipeline status. Use for "pipeline" intent. Input: { brand_id, client_id? }.
8. search_web: General web search. Input: { query, max_results? }.
`;

function buildSearchQueries(parameters: Record<string, unknown>, userMessage: string): string[] {
  const queries: string[] = [];

  const location = (parameters.location as string) || "";
  const industry = (parameters.industry as string) || "";
  const painPoint = (parameters.pain_point as string) || "";

  if (userMessage && userMessage.length > 10) {
    queries.push(userMessage);
  }
  if (location && industry) {
    queries.push(`${industry} companies in ${location}`);
  } else if (location) {
    queries.push(`companies in ${location}`);
    queries.push(`businesses in ${location}`);
  }
  if (industry) {
    queries.push(`${industry} companies`);
  }
  if (painPoint) {
    queries.push(`companies solving ${painPoint}`);
    queries.push(`businesses with ${painPoint}`);
  }
  if (queries.length === 0) {
    queries.push(userMessage || "potential leads");
  }

  return queries.slice(0, 5);
}

function hardcodedPlanner(intent: string, brand: BrandProfile, parameters: Record<string, unknown>, userMessage: string): z.infer<typeof PlannerOutputSchema> {
  const maxLeads = OrchestratorConfig.MAX_LEADS_PER_QUERY;

  switch (intent) {
    case "discover": {
      const searchQueries = buildSearchQueries(parameters, userMessage);
      const location = (parameters.location as string) || "";
      const industry = (parameters.industry as string) || "";
      const parts = [location, industry].filter(Boolean);
      const intentDescription = `Find ${parts.length ? parts.join(" ") : "new leads"}`;
      return {
        steps: [{ tool: "discover_leads", input: { brand_id: brand.id, client_id: brand.client_id, limit: maxLeads, search_queries: searchQueries }, dependsOn: [] }],
        searchQueries,
        intentDescription,
      };
    }
    case "research":
      return {
        steps: [{ tool: "research_leads", input: { brand_id: brand.id, client_id: brand.client_id, max_leads: maxLeads, query: userMessage }, dependsOn: [] }],
      };
    case "enrich":
      return {
        steps: [{ tool: "enrich_leads", input: { brand_id: brand.id, client_id: brand.client_id, max_leads: maxLeads }, dependsOn: [] }],
      };
    case "qualify":
      return {
        steps: [{ tool: "qualify_leads", input: { brand_id: brand.id, client_id: brand.client_id, max_leads: maxLeads, query: userMessage }, dependsOn: [] }],
      };
    case "outreach":
      return {
        steps: [{ tool: "draft_emails", input: { brand_id: brand.id, client_id: brand.client_id, max_leads: maxLeads, query: userMessage }, dependsOn: [] }],
      };
    case "send":
      return {
        steps: [{ tool: "send_emails", input: { brand_id: brand.id, client_id: brand.client_id }, dependsOn: [] }],
      };
    case "pipeline":
      return {
        steps: [{ tool: "get_pipeline", input: { brand_id: brand.id, client_id: brand.client_id }, dependsOn: [] }],
      };
    default:
      return { steps: [] };
  }
}

export async function generatePlan(
  input: PlannerInput,
): Promise<z.infer<typeof PlannerOutputSchema>> {
  const { intent, parameters, brand, previousSearchQueries, userMessage } = input;

  const cacheKey = `${brand.id}:${intent}:${JSON.stringify(parameters)}`;
  const cached = plannerCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.result;
  }

  if (intent === "chat") {
    return { steps: [] };
  }

  const parametersStr = Object.entries(parameters)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");

  try {
    const prompt = `You are a workflow planner for ${brand.brand_name}. Generate a step-by-step execution plan.

Brand context:
${brand.positioning ? `- Positioning: ${brand.positioning}` : ""}
${brand.core_offer ? `- Core offer: ${brand.core_offer}` : ""}
${brand.audience ? `- Audience: ${brand.audience}` : ""}

User intent: ${intent}
User parameters:
${parametersStr || "(none provided)"}
${previousSearchQueries && previousSearchQueries.length > 0 ? `Previously used search queries: ${previousSearchQueries.join(", ")}` : ""}

${TOOL_REGISTRY_DESCRIPTION}

Rules:
- Generate at most 2 steps per response
- For "discover" intent: generate specific search queries based on the parameters. Choose appropriate data sources (Eventbrite for events, LinkedIn for companies, web for general). Include brand-relevant keywords.
- Steps run sequentially (dependsOn: [prev_step_index])
- If a parameter was provided, use it in the input
- If user wants full pipeline, only plan the current step

For "discover" intent, the intentDescription should be a concise description (1 sentence) of what was searched for, to save as a reusable intent later.

Respond with valid JSON only:
{
  "steps": [{"tool": "...", "input": {...}, "dependsOn": [0]}],
  "searchQueries": ["query1", "query2", "query3"],
  "intentDescription": "description of what was searched"
}`;

    const result = await generateStructured(prompt, PlannerOutputSchema, 0.1, brand.client_id);

    plannerCache.set(cacheKey, { result, expiry: Date.now() + CACHE_TTL });

    logger.info({ stepCount: result.steps.length, queries: result.searchQueries?.length }, "Plan generated");
    return result;
  } catch (err) {
    logger.warn({ err }, "LLM planner failed, using hardcoded fallback");
    return hardcodedPlanner(intent, brand, parameters, userMessage || "");
  }
}
