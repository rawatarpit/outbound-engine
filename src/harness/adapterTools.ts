import type { ToolDefinition } from "./types";
import { z } from "zod";
import { redditSearchAdapter } from "../discovery/signals/adapters/reddit-search";
import { pushshiftAdapter } from "../discovery/signals/adapters/pushshift";
import { indeedAdapter } from "../discovery/signals/adapters/indeed";
import { executeScraplingSearch } from "../core/utils/scrapling";
import pino from "pino";

const logger = pino({ level: "info" });

export const ADAPTER_TOOLS: ToolDefinition[] = [
  {
    name: "search_reddit",
    description: `
      WHAT: Searches Reddit via OAuth API for posts mentioning companies, pain points, or hiring signals.
      WHEN: Use for queries targeting startup/entrepreneur subreddits to find real companies discussing needs.
      RETURNS: Array of DiscoveryCompany with source_url, name, summary, signal_type.
      AVOID: Requires REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET. Falls back to unauthenticated if not set.
    `,
    input_schema: z.object({
      query: z.string().describe("Reddit search query with signal keywords"),
      intent_id: z.string().describe("Intent identifier"),
      signal: z.string().describe("Signal type (pain, hiring, etc.)"),
      limit: z.number().optional().default(10),
      clientId: z.string().optional(),
    }),
    executor: async ({ query, intent_id, signal, limit, clientId }) => {
      const result = await redditSearchAdapter({ query, intent_id, signal, limit, clientId });
      return result.companies || [];
    },
    metadata: {
      category: "search",
      timeout_ms: 15000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },
  {
    name: "search_pushshift",
    description: `
      WHAT: Searches Reddit historical data via Pushshift API for startup/entrepreneur subreddit posts.
      WHEN: Use for pain signal detection — finds companies discussing struggles, hiring, or needs in Reddit archives.
      RETURNS: Array of DiscoveryCompany with source_url, name, summary, signal_type.
      AVOID: Pushshift data can be delayed by hours. For real-time Reddit use search_reddit instead.
    `,
    input_schema: z.object({
      query: z.string().describe("Search query"),
      intent_id: z.string().describe("Intent identifier"),
      signal: z.string().describe("Signal type"),
      max_results: z.number().optional().default(25),
      subreddits: z.array(z.string()).optional(),
    }),
    executor: async ({ query, intent_id, signal, max_results, subreddits }) => {
      const result = await pushshiftAdapter({ query, intent_id, signal, max_results, subreddits });
      return result.companies || [];
    },
    metadata: {
      category: "search",
      timeout_ms: 20000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },
  {
    name: "search_indeed",
    description: `
      WHAT: Scrapes Indeed job listings to find companies actively hiring for specific roles.
      WHEN: Use for hiring signal detection — companies posting jobs are growing and have budget.
      RETURNS: Array of DiscoveryCompany with name, domain (resolved), source_url, signal_type.
      AVOID: Indeed may block automated scraping. Rate-limit carefully (max 5/min).
    `,
    input_schema: z.object({
      query: z.string().describe("Job search query (e.g. 'software engineer saas')"),
      intent_id: z.string().describe("Intent identifier"),
      signal: z.string().describe("Signal type"),
      max_results: z.number().optional().default(20),
      location: z.string().optional().default(""),
    }),
    executor: async ({ query, intent_id, signal, max_results, location }) => {
      const result = await indeedAdapter({ query, intent_id, signal, max_results, location });
      return result.companies || [];
    },
    metadata: {
      category: "search",
      timeout_ms: 20000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },
  {
    name: "search_jobs",
    description: `
      WHAT: Searches for job postings via DuckDuckGo Jobs search to find companies hiring.
      WHEN: Use as a general-purpose job search when Indeed is rate-limited or unavailable.
      RETURNS: Array of results with title, url, company, body.
      AVOID: Less reliable than Indeed for company discovery. Use as fallback.
    `,
    input_schema: z.object({
      query: z.string().describe("Job search query"),
      max_results: z.number().optional().default(10),
    }),
    executor: async ({ query, max_results }) => {
      const results = await executeScraplingSearch(query, "jobs", max_results);
      return results.map(r => ({
        source: "jobs",
        source_url: r.url || "",
        domain: r.company ? `${r.company.toLowerCase().replace(/\s+/g, "")}.com` : "unknown.com",
        name: r.company || r.title || "Unknown",
        title: r.title || "",
        summary: r.body || "",
        signal_type: "hiring",
        relevance_score: 60,
        urgency_score: 50,
        fit_reason: `Job posting: ${query}`,
        raw: { query, source: "scrapling_jobs" },
      }));
    },
    metadata: {
      category: "search",
      timeout_ms: 35000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },
  {
    name: "search_news",
    description: `
      WHAT: Searches for news articles via DuckDuckGo News search to find funding/launch signals.
      WHEN: Use for funding, expansion, and partnership signal detection.
      RETURNS: Array of results with title, url, body, source.
      AVOID: Returns news articles, not company profiles. Filter for company mentions.
    `,
    input_schema: z.object({
      query: z.string().describe("News search query (e.g. 'funding saas startup')"),
      max_results: z.number().optional().default(10),
    }),
    executor: async ({ query, max_results }) => {
      const results = await executeScraplingSearch(query, "news", max_results);
      return results.map(r => ({
        source: "news",
        source_url: r.url || "",
        domain: "unknown.com",
        name: r.company || r.title?.split(" ").slice(0, 3).join(" ") || "Unknown",
        title: r.title || "",
        summary: r.body || "",
        signal_type: "funding",
        relevance_score: 55,
        urgency_score: 40,
        fit_reason: `News article: ${query}`,
        raw: { query, source: "scrapling_news" },
      }));
    },
    metadata: {
      category: "search",
      timeout_ms: 35000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },
];

export function getAdapterTool(name: string): ToolDefinition | undefined {
  return ADAPTER_TOOLS.find(t => t.name === name);
}

export function getAdapterToolsBySource(source: string): ToolDefinition | undefined {
  const sourceToTool: Record<string, string> = {
    reddit: "search_reddit",
    pushshift: "search_pushshift",
    indeed: "search_indeed",
    jobs: "search_jobs",
    news: "search_news",
  };
  const toolName = sourceToTool[source];
  if (!toolName) return undefined;
  return getAdapterTool(toolName);
}
