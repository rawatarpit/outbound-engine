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

type RouterResult = z.infer<typeof RouterSchema>;

const routerCache = new Map<string, { result: RouterResult; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

const KEYWORD_ROUTES: Array<{
  patterns: RegExp[];
  intent: RouterResult["intent"];
  confidence: number;
  extractParams: (msg: string) => Record<string, unknown>;
}> = [
  {
    patterns: [/find/i, /search/i, /discover/i, /look for/i, /find me/i, /show me/i, /get me/i, /need.*(leads|companies|prospects)/i, /looking for/i, /help.*find/i, /hunt/i],
    intent: "discover",
    confidence: 0.85,
    extractParams: (msg: string) => {
      const params: Record<string, unknown> = {};
      const locMatch = msg.match(/(?:in|near|around|based in|located in)\s+([a-zA-Z\s,]+?)(?:\s+(?:that|which|with|and|for|companies|businesses|leads)|$)/i);
      if (locMatch) params.location = locMatch[1].trim();
      const indMatch = msg.match(/([\w\s]+?)\s+(?:companies|businesses|firms|startups|leads|prospects)/i);
      if (indMatch && indMatch[1] && !indMatch[1].match(/^(find|search|discover|show|get|look for|in|near|some|more|the)$/i)) {
        params.industry = indMatch[1].trim();
      }
      const cntMatch = msg.match(/(\d+)\s*(?:leads?|companies?|results?)/i);
      if (cntMatch) params.lead_count = parseInt(cntMatch[1]);
      return params;
    },
  },
  {
    patterns: [/research/i, /investigate/i, /learn about/i, /find info/i, /tell me about/i, /background/i],
    intent: "research",
    confidence: 0.85,
    extractParams: () => ({}),
  },
  {
    patterns: [/enrich/i, /contacts?/i, /emails?/i, /find contacts?/i, /find emails?/i, /contact info/i, /get in touch/i, /reach out/i],
    intent: "enrich",
    confidence: 0.85,
    extractParams: () => ({}),
  },
  {
    patterns: [/qualify/i, /score/i, /rate/i, /evaluate/i, /fit/i, /icp/i],
    intent: "qualify",
    confidence: 0.85,
    extractParams: () => ({}),
  },
  {
    patterns: [/draft/i, /email/i, /outreach/i, /write/i, /compose/i, /create.*email/i, /generate.*email/i, /email.*sequence/i, /cold.*email/i],
    intent: "outreach",
    confidence: 0.85,
    extractParams: () => ({}),
  },
  {
    patterns: [/send/i, /send email/i, /send draft/i, /dispatch/i],
    intent: "send",
    confidence: 0.85,
    extractParams: () => ({}),
  },
  {
    patterns: [/pipeline/i, /status/i, /progress/i, /where/i, /how.?far/i, /what.*(done|found|have)/i, /show.*pipeline/i, /current.*state/i, /update/i],
    intent: "pipeline",
    confidence: 0.85,
    extractParams: () => ({}),
  },
  {
    patterns: [/analyze/i, /reply/i, /respond/i, /response/i, /follow.up/i],
    intent: "analyze",
    confidence: 0.85,
    extractParams: () => ({}),
  },
];

function keywordRouteIntent(message: string): RouterResult | null {
  const lower = message.toLowerCase();

  // Greeting / chitchat — route as chat
  if (/^(hi|hey|hello|good\s*(morning|afternoon|evening)|what'?s?\s*up|sup|howdy)\b/i.test(lower)) {
    return { intent: "chat", confidence: 0.9, parameters: {}, missingParams: [] };
  }
  if (/^(thanks?|thank you|appreciate|great|awesome|perfect|ok|okay|sure)\b/i.test(lower)) {
    return { intent: "chat", confidence: 0.9, parameters: {}, missingParams: [] };
  }
  if (/^(can you|what can you|what do you|how do you|who are you|tell me about yourself)\b/i.test(lower)) {
    return { intent: "chat", confidence: 0.8, parameters: {}, missingParams: [] };
  }
  if (/^(help|what can i|what should i|how (does|can|should))\b/i.test(lower)) {
    return { intent: "chat", confidence: 0.75, parameters: {}, missingParams: [] };
  }

  for (const route of KEYWORD_ROUTES) {
    if (route.patterns.some(p => p.test(lower))) {
      const params = route.extractParams(message);
      logger.info({ intent: route.intent, params, source: "keyword" }, "Keyword router matched");
      return {
        intent: route.intent,
        confidence: route.confidence,
        parameters: params,
        missingParams: [],
      };
    }
  }

  return null;
}

export async function routeIntent(
  message: string,
  brand: BrandProfile,
  conversationContext?: string,
): Promise<RouterResult> {
  const cacheKey = `${brand.id}:${message.slice(0, 200)}`;
  const cached = routerCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.result;
  }

  // Keyword fast path (instant, no LLM)
  const keywordResult = keywordRouteIntent(message);
  if (keywordResult) {
    routerCache.set(cacheKey, { result: keywordResult, expiry: Date.now() + CACHE_TTL });
    return keywordResult;
  }

  // LLM fallback (15s timeout — Llama 3.1 8B should handle this easily)
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
    const result = await generateStructured(prompt, RouterSchema, 0.1, brand.client_id, 300, undefined, 60000);
    routerCache.set(cacheKey, { result, expiry: Date.now() + CACHE_TTL });
    logger.info({ intent: result.intent, confidence: result.confidence, params: result.parameters }, "Intent routed (LLM)");
    return result;
  } catch (err) {
    logger.error({ err }, "LLM router failed");
    return { intent: "chat", confidence: 0.5, parameters: {}, missingParams: [] };
  }
}
