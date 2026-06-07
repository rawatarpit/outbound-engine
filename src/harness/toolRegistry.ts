import type { ToolDefinition } from "./types";
import { z } from "zod";
import { scrapeUrl } from "../core/utils/scraper";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const OPEN_SOURCE_DIR = path.resolve(__dirname, "../../open_source");
const SCRIPTS_DIR = path.resolve(__dirname, "../../scripts");

const SCRAPE_TIMEOUT = 30000;

function callPythonScript(
  scriptPath: string,
  params: Record<string, unknown>,
  timeoutMs: number = 120000,
): Promise<string> {
  return execFileAsync("python3", [scriptPath, JSON.stringify(params)], {
    timeout: timeoutMs,
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || ""}` },
  }).then(r => r.stdout.trim());
}

export const LEAD_GEN_TOOLS: ToolDefinition[] = [
  {
    name: "scrape_website",
    description: `
      WHAT: Scrapes a company website and returns the visible text content.
      WHEN: Use when you need to analyze a company's website to understand their business, technology stack, or messaging.
      RETURNS: Raw text content stripped of HTML tags, up to 8000 characters.
      AVOID: Do not use for search engines or aggregator sites — only for company websites.
    `,
    input_schema: z.object({
      url: z.string().describe("The full URL of the website to scrape"),
    }),
    executor: async ({ url }: { url: string }) => {
      return scrapeUrl(url, 8000);
    },
    metadata: {
      category: "search",
      timeout_ms: SCRAPE_TIMEOUT,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },
  {
    name: "generate_research",
    description: `
      WHAT: Analyzes company website content and extracts structured research data (industry, pain points, buying signals).
      WHEN: After scraping a company website. Use to produce structured research for qualification and outreach.
      RETURNS: JSON with industry, size_estimate, pain_points, buying_signals, automation_maturity, sponsorship_potential, summary.
      AVOID: Do not use without first scraping the company website.
    `,
    input_schema: z.object({
      brand_name: z.string(),
      positioning: z.string(),
      core_offer: z.string(),
      audience: z.string(),
      website_content: z.string(),
      context_preamble: z.string().optional(),
      compaction: z.string().optional(),
    }),
    executor: async () => {
      throw new Error("generate_research is handled by the research agent directly");
    },
    metadata: {
      category: "compute",
      timeout_ms: 60000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "cheap",
    },
  },
  {
    name: "score_qualification",
    description: `
      WHAT: Scores a lead against the ideal customer profile based on research data.
      WHEN: After research is complete. Use to determine whether a company is worth pursuing.
      RETURNS: JSON with fit_score (0-100), reasoning, and confidence (0-1).
      AVOID: Do not use without research data. Do not use for companies that failed research.
    `,
    input_schema: z.object({
      brand_name: z.string(),
      core_offer: z.string(),
      industry: z.string(),
      pain_points: z.string(),
      automation_maturity: z.string(),
      buying_signals: z.string(),
      context_preamble: z.string().optional(),
    }),
    executor: async () => {
      throw new Error("score_qualification is handled by the qualification agent directly");
    },
    metadata: {
      category: "compute",
      timeout_ms: 60000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "cheap",
    },
  },
  {
    name: "generate_outreach",
    description: `
      WHAT: Generates a personalized cold outreach email for a qualified lead.
      WHEN: After a lead scores above the qualification threshold. Use to create ready-to-send email drafts.
      RETURNS: JSON with subject line and email body.
      AVOID: Do not use for unqualified leads. Do not use without research and qualification data.
    `,
    input_schema: z.object({
      sender_name: z.string(),
      brand_name: z.string(),
      positioning: z.string(),
      tone: z.string(),
      recipient_name: z.string(),
      company_name: z.string(),
      pain_points: z.string(),
      context_preamble: z.string().optional(),
      compaction: z.string().optional(),
    }),
    executor: async () => {
      throw new Error("generate_outreach is handled by the outreach agent directly");
    },
    metadata: {
      category: "compute",
      timeout_ms: 60000,
      retryable: true,
      requires_confirmation: true,
      cost_tier: "cheap",
    },
  },
  {
    name: "save_to_database",
    description: `
      WHAT: Saves agent output to the Supabase database.
      WHEN: After generating any result that needs to be persisted (research, qualification, outreach).
      RETURNS: Confirmation of save with the record ID.
      AVOID: Do not use for intermediate data or debugging output.
    `,
    input_schema: z.object({
      table: z.string(),
      data: z.record(z.unknown()),
    }),
    executor: async () => {
      throw new Error("save_to_database is handled by the individual agent DB writes");
    },
    metadata: {
      category: "storage",
      timeout_ms: 10000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },

  // ── Open-Source Python Discovery Tools ──────────────────────────────────

  {
    name: "search_web",
    description: `
      WHAT: Searches the web via DuckDuckGo (primary) or SearXNG (fallback) for B2B company discovery.
      WHEN: Use to find companies matching search queries — supports web and news modes.
      RETURNS: Array of candidate objects with url, domain, signal_type, intent_id.
      AVOID: Do not use for general-purpose web searching unrelated to company discovery.
    `,
    input_schema: z.object({
      queries: z.array(z.object({
        text: z.string().describe("Search query text"),
        signal: z.string().describe("Signal type associated with this query"),
        intent_id: z.string().describe("Intent identifier"),
      })),
      max_results: z.number().default(5).describe("Maximum results per query"),
      mode: z.enum(["web", "news"]).optional().default("web").describe("Search mode: web or news"),
    }),
    executor: async ({ queries, max_results, mode }: { queries: { text: string; signal: string; intent_id: string }[]; max_results: number; mode?: string }) => {
      const params = { queries, max_results, ...(mode && mode !== "web" ? { mode } : {}) };
      const stdout = await callPythonScript(path.join(OPEN_SOURCE_DIR, "search.py"), params);
      const result = JSON.parse(stdout);
      return result.companies || [];
    },
    metadata: {
      category: "search",
      timeout_ms: 120000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },

  {
    name: "search_hackernews",
    description: `
      WHAT: Searches Hacker News via Algolia API for hiring threads and company-relevant stories.
      WHEN: Use when looking for companies actively hiring (HN Who Is Hiring) or discussing specific technologies/topics.
      RETURNS: Array of candidate objects with url, domain, signal_type, intent_id.
      AVOID: Do not use for general news search — limited to Hacker News content.
    `,
    input_schema: z.object({
      queries: z.array(z.object({
        text: z.string().describe("Search query text"),
        signal: z.string().describe("Signal type"),
        intent_id: z.string().describe("Intent identifier"),
      })),
      max_results: z.number().default(5).describe("Maximum results per query"),
    }),
    executor: async ({ queries, max_results }: { queries: { text: string; signal: string; intent_id: string }[]; max_results: number }) => {
      const stdout = await callPythonScript(path.join(OPEN_SOURCE_DIR, "search_hn.py"), { queries, max_results });
      const result = JSON.parse(stdout);
      return result.companies || [];
    },
    metadata: {
      category: "search",
      timeout_ms: 120000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },

  {
    name: "search_y_combinator",
    description: `
      WHAT: Searches Y Combinator company directory via Algolia API.
      WHEN: Use to find YC-backed companies matching specific criteria (industry, tech, stage).
      RETURNS: Array of candidate objects with url, domain, signal_type, intent_id.
      AVOID: Only returns YC companies — does not search the broader web.
    `,
    input_schema: z.object({
      queries: z.array(z.object({
        text: z.string().describe("Search query text"),
        signal: z.string().describe("Signal type"),
        intent_id: z.string().describe("Intent identifier"),
      })),
      max_results: z.number().default(5).describe("Maximum results per query"),
    }),
    executor: async ({ queries, max_results }: { queries: { text: string; signal: string; intent_id: string }[]; max_results: number }) => {
      const stdout = await callPythonScript(path.join(OPEN_SOURCE_DIR, "search_yc.py"), { queries, max_results });
      const result = JSON.parse(stdout);
      return result.companies || [];
    },
    metadata: {
      category: "search",
      timeout_ms: 120000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },

  {
    name: "enrich_company_forge",
    description: `
      WHAT: Enriches a company domain using the FORGE CLI tool — returns industry, tech stack, employees, revenue, emails.
      WHEN: After discovering a company domain. Use to fill in firmographic and technographic data.
      RETURNS: Object with industry, tech_stack, summary, employees, revenue, emails (or empty object on failure).
      AVOID: Requires FORGE CLI to be installed. Do not use for domains without an active website.
    `,
    input_schema: z.object({
      domain: z.string().describe("Company domain to enrich (e.g. example.com)"),
    }),
    executor: async ({ domain }: { domain: string }) => {
      try {
        const stdout = await callPythonScript(path.join(OPEN_SOURCE_DIR, "forge.py"), { domain }, 150000);
        return JSON.parse(stdout) || {};
      } catch {
        return {};
      }
    },
    metadata: {
      category: "compute",
      timeout_ms: 150000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "cheap",
    },
  },

  {
    name: "scrape_extract_company",
    description: `
      WHAT: Crawls a company website with Crawl4AI, then extracts structured data (name, industry, tech stack, people, emails) via NVIDIA LLM. Also grounds extraction against scraped text and finds emails via Bricks CLI.
      WHEN: After discovering a company URL. Use to get deep structured company intelligence.
      RETURNS: Object with name, domain, summary, industry, tech_stack, employees, funding, key_people, emails, extraction_confidence, confidence_tier, raw_content.
      AVOID: Requires LLM API key. May take 30-60s for a full crawl + extraction.
    `,
    input_schema: z.object({
      url: z.string().describe("Full URL of the company website"),
      domain: z.string().describe("Company domain"),
      llm_api_key: z.string().optional().describe("LLM API key for extraction"),
      llm_base_url: z.string().optional().describe("LLM base URL"),
      llm_model: z.string().optional().describe("LLM model name"),
    }),
    executor: async ({ url, domain, llm_api_key, llm_base_url, llm_model }: { url: string; domain: string; llm_api_key?: string; llm_base_url?: string; llm_model?: string }) => {
      const params = {
        url, domain,
        llm_api_key: llm_api_key || process.env.LLM_API_KEY || "",
        llm_base_url: llm_base_url || process.env.LLM_BASE_URL || "https://integrate.api.nvidia.com/v1",
        llm_model: llm_model || process.env.LLM_MODEL || "meta/llama-3.1-8b-instruct",
      };
      const stdout = await callPythonScript(path.join(OPEN_SOURCE_DIR, "scrape_extract.py"), params);
      const trimmed = stdout.trim();
      if (trimmed === "null" || !trimmed) return null;
      return JSON.parse(trimmed);
    },
    metadata: {
      category: "compute",
      timeout_ms: 120000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "expensive",
    },
  },

  {
    name: "extract_content_seeds",
    description: `
      WHAT: Reads scraped content like an analyst — extracts leads, pain points, signals, and follow-up queries using LLM.
      WHEN: After scraping a content source (blog, article, forum post). Use to extract structured discovery intelligence from raw content.
      RETURNS: Object with context_summary, author, pain_points, signals, queries (for further searching), leads (direct company mentions).
      AVOID: Requires LLM API key. Input content should be 1000-10000 chars for best results.
    `,
    input_schema: z.object({
      content: z.string().describe("Raw text content to analyze (up to 10000 chars)"),
      source_domain: z.string().describe("Domain where the content was found"),
      brand_context: z.string().describe("JSON string of brand context: brand_name, product, audience, core_offer, positioning"),
      llm_api_key: z.string().optional().describe("LLM API key"),
      llm_base_url: z.string().optional().describe("LLM base URL"),
      llm_model: z.string().optional().describe("LLM model name"),
    }),
    executor: async ({ content, source_domain, brand_context, llm_api_key, llm_base_url, llm_model }: { content: string; source_domain: string; brand_context: string; llm_api_key?: string; llm_base_url?: string; llm_model?: string }) => {
      const params = {
        content: content.slice(0, 10000),
        source_domain,
        brand_context,
        llm_api_key: llm_api_key || "",
        llm_base_url: llm_base_url || "https://integrate.api.nvidia.com/v1",
        llm_model: llm_model || "meta/llama-3.1-8b-instruct",
      };
      const stdout = await callPythonScript(path.join(OPEN_SOURCE_DIR, "seed_extract.py"), params, 60000);
      const result = JSON.parse(stdout);
      return {
        context_summary: result.context_summary || "",
        author: result.author || {},
        pain_points: result.pain_points || [],
        signals: result.signals || [],
        queries: result.queries || [],
        leads: result.leads || [],
      };
    },
    metadata: {
      category: "compute",
      timeout_ms: 60000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "cheap",
    },
  },

  {
    name: "search_ddg",
    description: `
      WHAT: Searches DuckDuckGo via the scrapling_search.py script for web, jobs, or news results.
      WHEN: Use as a general-purpose web search tool for company research, job postings, or news monitoring.
      RETURNS: Array of results with title, url, company (if detected), body snippet.
      AVOID: Rate-limited by DuckDuckGo. For bulk discovery use search_web instead.
    `,
    input_schema: z.object({
      query: z.string().describe("Search query"),
      source: z.enum(["google", "jobs", "news"]).optional().default("google").describe("Search category"),
      max_results: z.number().optional().default(10).describe("Maximum results to return"),
    }),
    executor: async ({ query, source, max_results }: { query: string; source?: string; max_results?: number }) => {
      const params = { query, source: source || "google", max_results: max_results || 10 };
      const stdout = await callPythonScript(path.join(SCRIPTS_DIR, "scrapling_search.py"), params, 35000);
      const parsed = JSON.parse(stdout);
      if (!parsed.success) return [];
      return parsed.results || [];
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
    name: "search_searxng",
    description: `
      WHAT: Searches a SearXNG self-hosted instance for web results. Used as fallback when DuckDuckGo is rate-limited.
      WHEN: When DDG search fails due to rate limiting. Requires a running SearXNG instance.
      RETURNS: Array of results with title, url, body snippet, source engine.
      AVOID: Requires SEARXNG_URL environment variable or default http://localhost:8080.
    `,
    input_schema: z.object({
      query: z.string().describe("Search query"),
      max_results: z.number().optional().default(10).describe("Maximum results"),
      base_url: z.string().optional().describe("SearXNG instance URL (defaults to env SEARXNG_URL or http://localhost:8080)"),
    }),
    executor: async ({ query, max_results, base_url }: { query: string; max_results?: number; base_url?: string }) => {
      const searxngUrl = base_url || process.env.SEARXNG_URL || "http://localhost:8080";
      const { default: axios } = await import("axios");
      const response = await axios.get(`${searxngUrl}/search`, {
        params: { q: query, format: "json", language: "en", safesearch: "0" },
        timeout: 15000,
      });
      const data = response.data;
      if (!data?.results) return [];
      return data.results.slice(0, max_results || 10).map((item: any) => ({
        title: item.title || "",
        url: item.url || "",
        body: item.content || "",
        source: item.engine || "searxng",
      }));
    },
    metadata: {
      category: "search",
      timeout_ms: 20000,
      retryable: true,
      requires_confirmation: false,
      cost_tier: "free",
    },
  },
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return LEAD_GEN_TOOLS.find(t => t.name === name);
}

export function getToolsByCategory(category: string): ToolDefinition[] {
  return LEAD_GEN_TOOLS.filter(t => t.metadata.category === category);
}
