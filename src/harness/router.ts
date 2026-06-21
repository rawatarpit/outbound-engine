import pino from "pino";
import { z } from "zod";
import { generateStructured } from "../llm/ollama";
import { BrandProfile } from "../db/supabase";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const RouterSchema = z.object({
  intent: z.enum(["discover", "research", "enrich", "qualify", "outreach", "send", "pipeline", "analyze", "chat"]),
  parameters: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
  missingParams: z.array(z.string()),
});

const routerCache = new Map<string, { result: z.infer<typeof RouterSchema>; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function routeIntent(
  message: string,
  brand: BrandProfile,
  conversationContext?: string,
): Promise<z.infer<typeof RouterSchema>> {
  const cacheKey = `${brand.id}:${message.slice(0, 200)}`;
  const cached = routerCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.result;
  }

  const prompt = `You are a sales engagement router for ${brand.brand_name}. Classify the user's intent and extract structured parameters.

${brand.positioning ? `Brand positioning: ${brand.positioning}` : ""}
${brand.core_offer ? `Core offer: ${brand.core_offer}` : ""}
${brand.audience ? `Target audience: ${brand.audience}` : ""}

Available intents:
- discover: Find new leads/prospects/companies matching criteria
- research: Research existing leads or companies in-depth
- enrich: Find contact details (emails, titles, LinkedIn) for leads
- qualify: Score/qualify leads against ideal customer profile
- outreach: Draft or write outreach emails
- send: Send drafted emails
- pipeline: Show current pipeline status
- analyze: Analyze replies or responses
- chat: General conversation, questions, help

For "discover" intent, extract these parameters:
- location: string (city, country, region — if mentioned)
- industry: string (industry or niche — if mentioned)
- pain_point: string (specific problem or need — if mentioned)
- lead_count: number (how many leads, default 10)
- company_size: string (startup, smb, enterprise — if mentioned)
- signals: string[] (buying signals like hiring, funding, growth, pain)

For "outreach" intent:
- lead_ids: string[] (specific leads — if mentioned)
- draft_count: number (how many drafts, default 5)

For "send" intent:
- draft_ids: string[] (specific drafts — if mentioned)

Conversation history (last 3 turns):
${conversationContext || "(none)"}

User: ${message}

Respond with valid JSON only:
{
  "intent": "...",
  "parameters": { ... },
  "confidence": 0.0-1.0,
  "missingParams": ["list of params the user didn't provide"]
}`;

  try {
    const result = await generateStructured(prompt, RouterSchema, 0.1, brand.client_id, 300, undefined, 30000);
    routerCache.set(cacheKey, { result, expiry: Date.now() + CACHE_TTL });
    logger.info({ intent: result.intent, confidence: result.confidence, params: result.parameters }, "Intent routed");
    return result;
  } catch (err) {
    logger.error({ err }, "LLM router failed");
    return { intent: "chat", confidence: 0.5, parameters: {}, missingParams: [] };
  }
}
