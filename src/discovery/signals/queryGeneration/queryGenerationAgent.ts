import { generateStructured } from "../../../llm/ollama"
import { QueryGenerationOutputSchema, type QueryGenerationOutput } from "./schema"
import type { BrandIntent, BrandProfile } from "../../../db/supabase"
import { getFeedbackSummary, getTopPerformingQueries } from "../../utils/feedback-loop"

const ADAPTER_PERFORMANCE: Record<string, { rateLimit: string; reliability: string; bestFor: string }> = {
  search: { rateLimit: "30/min", reliability: "high", bestFor: "finding companies via signal-rich Google searches" },
  yc: { rateLimit: "60/min", reliability: "high", bestFor: "structured Y Combinator company data with batch, industry, hiring status" },
  hackernews: { rateLimit: "60/min", reliability: "high", bestFor: "Show HN launches and Ask HN hiring threads" },
  hn_hiring: { rateLimit: "60/min", reliability: "high", bestFor: "who is hiring threads — active hiring companies with verified domains" },
  jobs: { rateLimit: "10/min", reliability: "high", bestFor: "job postings at SaaS startups via Google Jobs" },
  pushshift: { rateLimit: "120/min", reliability: "high", bestFor: "archival Reddit data in startup/entrepreneur subreddits" },
  techcrunch: { rateLimit: "30/min", reliability: "medium", bestFor: "funding announcements and acquisition news" },
  news: { rateLimit: "10/min", reliability: "high", bestFor: "Google News search for funding/launch/partnership news" },
  reddit: { rateLimit: "10/min", reliability: "medium", bestFor: "current Reddit posts in startup/entrepreneur/SaaS subreddits" },
  producthunt: { rateLimit: "10/min", reliability: "medium", bestFor: "new product launches with traction (real companies)" },
  freelance: { rateLimit: "10/min", reliability: "medium", bestFor: "companies posting projects on Upwork/Fiverr/Toptal" },
  blogs: { rateLimit: "10/min", reliability: "medium", bestFor: "engineering blogs on Medium/Dev.to mentioning tech stack issues" },
  community: { rateLimit: "10/min", reliability: "medium", bestFor: "pain signals on IndieHackers/Quora/StackOverflow" },
  github: { rateLimit: "60/min", reliability: "low", bestFor: "active repos in relevant tech stacks (needs GITHUB_TOKEN)" },
  indeed: { rateLimit: "5/min", reliability: "low", bestFor: "companies actively hiring software engineers" },
  crunchbase: { rateLimit: "2/min", reliability: "low", bestFor: "funded companies by keyword" },
  wellfound: { rateLimit: "10/min", reliability: "low", bestFor: "startups hiring on AngelList/Wellfound" },
  stackshare: { rateLimit: "5/min", reliability: "low", bestFor: "companies using specific tech stacks" },
}

export async function generateQueriesForIntent(
  intent: BrandIntent,
  brand: BrandProfile,
  similarIntents?: { intent_text: string; signal: string; similarity: number }[],
  clientId?: string,
): Promise<QueryGenerationOutput> {
  const ragContext = similarIntents && similarIntents.length > 0
    ? `\n\nSIMILAR INTENTS THAT MATCHED THIS BRAND (from RAG vector search):\n${
        similarIntents.map(si =>
          `- "${si.intent_text}" [signal: ${si.signal}, similarity: ${(si.similarity * 100).toFixed(0)}%]`
        ).join("\n")
      }\n\nLearn from these: they represent past patterns that found real companies with signals. Generate queries with similar specificity and signal-focus.`
    : "\n\nNo similar intents found — this is a new intent pattern. Generate exploratory queries across multiple angles."

  const signalName = (Array.isArray(intent.signals) ? intent.signals[0] : "pain") || "pain"
  const adapterLookup: Record<string, string> = {
    hiring: "hn_hiring",
    funding: "techcrunch",
    pain: "pushshift",
    automation_need: "pushshift",
    tech_usage: "github",
    growth_activity: "yc",
    partnership: "search",
    outbound_pain: "reddit",
    expansion: "news",
    migration: "stackshare",
    compliance: "news",
    burnout: "reddit",
  }
  const preferredAdapters = ADAPTER_PERFORMANCE[adapterLookup[signalName] || "search"]

  const adapterIntel = Object.entries(ADAPTER_PERFORMANCE)
    .filter(([name]) => {
  const signalMap: Record<string, string[]> = {
    hiring: ["hn_hiring", "indeed", "wellfound", "jobs", "search", "reddit"],
    pain: ["reddit", "hackernews", "search", "community", "pushshift"],
    funding: ["techcrunch", "crunchbase", "news", "search"],
    automation_need: ["reddit", "hackernews", "search", "pushshift", "community"],
    tech_usage: ["stackshare", "github", "search"],
    growth_activity: ["yc", "producthunt", "news", "search"],
    partnership: ["search", "news", "blogs"],
    outbound_pain: ["reddit", "hackernews", "community", "search"],
    expansion: ["news", "search", "techcrunch"],
    migration: ["search", "reddit", "hackernews", "stackshare"],
    compliance: ["news", "search", "blogs"],
    burnout: ["reddit", "hackernews", "community", "jobs"],
  }
      return signalMap[signalName]?.includes(name)
    })
    .map(([name, info]) => `  - ${name}: ${info.rateLimit}, ${info.reliability} reliability, ${info.bestFor}`)
    .join("\n")

  const prompt = `You are a B2B lead discovery strategist for a software agency.
Your job is to generate search queries that find REAL companies SHOWING SIGNALS of needing your service.

The agency builds: ${brand.core_offer}
Target audience: ${brand.audience}
Positioning: ${brand.positioning}

⭐ CRITICAL: Every query must return results that contain BOTH a real company AND a signal.
A "signal" is evidence a company needs your service — hiring, pain, funding, etc.

SIGNAL-RICH QUERY PATTERNS (use these exclusively):

HIRING SIGNAL → company is growing, has budget:
- site:wellfound.com "hiring" "engineer" "saas" OR "startup"
- site:linkedin.com/company "hiring" "software" "developer"
- "hiring" "react" OR "node" OR "python" "startup" "seed funded"
- "careers" "engineering" "saas" "company" hiring

PAIN SIGNAL → company is struggling, needs help:
- "we built" "mvp" "agency" OR "studio" founder
- "struggling with" "development" "product" founder
- "outsource" OR "outsourcing" "development" "startup" problem
- "too slow" "engineering" "startup" "build" product
- "scaling" "engineering" "problems" "startup" founder
- "looking for" "development partner" OR "technical co-founder"

FUNDING SIGNAL → company has money to spend:
- "raised" "$" "million" "seed" "saas" OR "startup"
- "series" "funding" "announced" "saas" platform
- "secured" "funding" "seed" "round" startup

TECH USAGE SIGNAL → company is using specific tools (may need migration):
- "built on" "react" OR "node" "startup" "saas"
- "migrating from" OR "moving to" "cloud" "infrastructure" startup

⭐ For "search" adapter queries, ALWAYS use signal-rich patterns above — never generic keyword lists.

⭐ For "jobs" adapter: "engineer" "saas" "remote" OR "on-site" hiring startup

⭐ For "news" adapter: "funding" "seed" OR "series" "saas" startup raised

⭐ For "reddit" adapter: subreddit:startups OR subreddit:entrepreneur "hiring" OR "struggling" OR "built"

⭐ For "yc" adapter: search YC companies by keyword (these are verified real companies):
- yc: '"saas" "b2b" "enterprise"'
- yc: '"developer" "tools" OR "infrastructure"'
Then for each YC company found, also generate a "search" query that finds signals about them:
- search: 'site:linkedin.com/company "REPLACE_WITH_COMPANY" hiring'

⭐ For "producthunt" adapter: find products with traction (real companies behind them):
- producthunt: '"automation" OR "workflow" "saas"'

⭐ For "indeed" adapter: find companies hiring for specific roles:
- indeed: '"software engineer" OR "full stack" saas'

⭐ For "crunchbase" adapter: find funded companies by keyword:
- crunchbase: '"saas" "funded" OR "series a"'

⭐ For "wellfound" adapter: find startups hiring on AngelList/Wellfound:
- wellfound: '"hiring" "engineer" saas startup'

⭐ For "techcrunch" adapter: find recently funded companies via funding news:
- techcrunch: '"raises" OR "funding" "series" saas'

⭐ For "pushshift" adapter: search Reddit historical data via Pushshift API:
- pushshift: 'subreddit:startups hiring OR struggling OR built'

⭐ For "stackshare" adapter: find companies using specific tech stacks:
- stackshare: '"react" OR "node.js" "saas"'

WHAT GOOD QUERIES LOOK LIKE (company + signal combined):
- search: '"hiring" "engineer" "saas" "startup" "remote"'
- search: '"struggling with" OR "challenges" "development" founder startup'
- search: '"raised" "$" "million" "seed" "saas" platform'
- search: 'site:wellfound.com "hiring" "engineer" "series a" OR "seed"'
- jobs: '"software engineer" saas startup remote'
- news: '"funding" "saas" "seed" OR "series a" announced'
- reddit: 'subreddit:startups "hiring" OR "built" OR "struggling"'
- hackernews: '"Ask HN" who is hiring OR looking for co-founder'
- yc: '"saas" "b2b"'
- producthunt: '"automation" OR "workflow"'

WHAT BAD QUERIES LOOK LIKE (return noise, no real companies with signals):
- "middle east startups mvp built fast" (vague, returns blog posts)
- "companies needing automation" (no signal, returns SEO articles)
- "SaaS companies" (no signal at all)
- "best tools for X" (listicles, not companies)
- site:indiehackers.com "struggling with" development founder startup Jo. (hallucinated filler "Jo." — produces ZERO results)
- "funding" "saas" company OR startup raised money Oza od puku (random invented words — produces ZERO results)

Generate search queries for this intent:

INTENT: "${intent.intent}"
SIGNALS: ${JSON.stringify(intent.signals)}
PRIORITY: ${intent.priority}
${ragContext}

${getFeedbackSummary()}

ADAPTER PERFORMANCE DATA (use to allocate queries strategically):
${adapterIntel}

ALLOCATION STRATEGY:
- Prioritize high-reliability adapters (hn_hiring, yc, hackernews, jobs, pushshift) for the bulk of queries
- Use medium-reliability adapters (techcrunch, reddit, producthunt, news) for 1-2 targeted queries each
- Use low-reliability or rate-limited adapters (indeed, crunchbase, wellfound, stackshare, github) sparingly — at most 1 query each
- Allocate at least 2 queries to search adapter (signal-rich Google searches find the most variety)
- Total: 10-15 queries. Quality over quantity — prefer adapters that match the signal type

${(getTopPerformingQueries().length > 0 ? `TOP PERFORMING QUERIES (replicate these patterns):\n${getTopPerformingQueries().join("\n")}` : "")}

CRITICAL RULES — MUST FOLLOW ALL:
1. NEVER invent or hallucinate company names, names, places, or text in any query. Every word in the query must be a real signal keyword (hiring, funding, built, struggling, etc.) or operator (site:, OR, AND, subreddit:, quotes).
2. NEVER append random words, placeholder names, or filler text (like "Jo.", "Ol decijfe", "hisgo") to queries — this guarantees zero results.
3. NEVER include example company names or demo text in the query field.
4. Queries must be REAL search strings — only keywords, operators, and site/subreddit filters. No narrative text.
5. For "search" adapter: ALWAYS use signal-rich patterns with quotes, site:, OR operators
6. For "yc" adapter: Simple keywords — YC will match them against its company directory
7. For "producthunt" adapter: Simple keywords — matched against product names/tags
8. For "reddit", "hackernews": Target specific subreddits/threads with signal context
9. For "jobs": Find actual job postings at real companies
10. expected_signal must be a SINGLE value like "hiring", NOT "hiring|pain|funding"

IMPORTANT: Respond with valid JSON matching the schema:
{
  "queries": [{ "adapter": "search|reddit|hackernews|news|jobs|blogs|community|github|hn_hiring|yc|producthunt|indeed|crunchbase|wellfound|techcrunch|pushshift|stackshare", "query": "string", "rationale": "string", "expected_signal": "one of: hiring | pain | funding | automation_need | tech_usage | growth_activity | partnership | outbound_pain | expansion | migration | compliance | burnout", "priority": 1-10 }],
  "reasoning": "string",
  "avoid_patterns": ["string"]
}`

  return await generateStructured(
    prompt,
    QueryGenerationOutputSchema,
    0.7,
    clientId,
    2048,
  )
}
