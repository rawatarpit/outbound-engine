import pino from "pino";
import { z } from "zod";
import type { DiscoveryResult, DiscoveryCompany, DiscoveryContact } from "./types";
import { supabase } from "../db/supabase";

/* =========================================================
   RISK CLASSIFICATION
========================================================= */

export type DiscoveryRisk = "low_api" | "medium_api" | "high_scrape" | "static";

/* =========================================================
   COST CATEGORY
========================================================= */

export type CostCategory = "low" | "medium" | "high";

/* =========================================================
      EXECUTION CONTRACT
========================================================= */

export interface ExecutorParams<TConfig = unknown> {
  sourceId: string;
  brandId: string;
  config: TConfig;
}

export type Executor<TConfig = unknown> = (
  params: ExecutorParams<TConfig>,
) => Promise<DiscoveryResult>;

export type BatchExecutor<TConfig = unknown> = (
  params: ExecutorParams<TConfig>,
  onBatch: (batch: DiscoveryResult) => Promise<void>,
  batchSize?: number,
) => Promise<void>;

export type AnyExecutor<TConfig = unknown> = Executor<TConfig> | BatchExecutor<TConfig>;

/* =========================================================
      REGISTERED EXECUTOR DEFINITION
========================================================= */

export interface RegisteredExecutor<TConfig = unknown> {
  type: string;
  risk: DiscoveryRisk;
  cost: CostCategory;
  requiresAuth: boolean;
  requiresInputAgent?: boolean;
  schema: z.ZodSchema<TConfig>;
  execute: AnyExecutor<TConfig>;
}

/* =========================================================
     LOGGER
========================================================= */

const logger = pino({ level: "info" });

/* =========================================================
     INTERNAL REGISTRY
========================================================= */

const registry = new Map<string, RegisteredExecutor<any>>();

/* =========================================================
     REGISTER EXECUTOR
========================================================= */

export function registerExecutor<TConfig>(def: RegisteredExecutor<TConfig>) {
  const key = def.type?.toLowerCase();

  if (!key) {
    throw new Error("Executor type cannot be empty");
  }

  if (registry.has(key)) {
    throw new Error(`Executor "${key}" already registered`);
  }

  registry.set(key, def);

  logger.info(
    {
      executor: key,
      risk: def.risk,
      cost: def.cost,
      requiresAuth: def.requiresAuth,
    },
    "Discovery executor registered",
  );
}

/* =========================================================
     GET EXECUTOR
========================================================= */

export function getExecutor(type: string): RegisteredExecutor<any> | null {
  if (!type) return null;
  return registry.get(type.toLowerCase()) ?? null;
}

/* =========================================================
     LIST EXECUTORS
========================================================= */

export function listExecutors(): RegisteredExecutor<any>[] {
  return Array.from(registry.values());
}

/* =========================================================
     VALIDATION (RECOMMENDED HARDENING)
========================================================= */

export function assertExecutorExists(type: string) {
  const exists = registry.has(type.toLowerCase());
  if (!exists) {
    throw new Error(`Executor not registered: ${type}`);
  }
}

/* =========================================================
     SOURCE-DRIVEN ADAPTER EXECUTORS
========================================================= */

import { fetchRedditPosts, fetchMultipleSubreddits } from "./adapters/reddit";
import { fetchHNStories } from "./adapters/hn";
import { fetchIndieHackersDiscussions } from "./adapters/indiehackers";
import { fetchRemoteOKJobs } from "./adapters/remoteok";
import { fetchProductHuntRSS } from "./adapters/producthunt";
import { extractSignal, type Signal } from "./core/signal-extractor";
import { matchOpportunity, filterHighIntentOpportunities, type BrandContext } from "./core/opportunity-matcher";
import { normalizeOpportunity, type NormalizedOpportunity } from "./core/normalizer";

/* ---- SCHEMAS ---- */

const redditSchema = z.object({
  subreddits: z.array(z.string()).default(["manufacturing", "healthit", "finance", "smallbusiness"]),
  limitPerSubreddit: z.number().default(10),
});

const hnSchema = z.object({
  tags: z.string().default("story"),
  hitsPerPage: z.number().default(30),
});

const ihSchema = z.object({
  forumUrl: z.string().default("https://www.indiehackers.com/forum"),
  maxPosts: z.number().default(15),
});

const remoteokSchema = z.object({
  limit: z.number().default(50),
});

const phSchema = z.object({
  maxItems: z.number().default(20),
});

/* ---- HELPER: Get brand context from DB ---- */

async function getBrandContext(brandId: string): Promise<BrandContext> {
  const { data, error } = await supabase
    .from("brand_profiles")
    .select("product, core_offer, positioning, audience")
    .eq("id", brandId)
    .single();

  if (error || !data) {
    logger.warn({ brandId, error: error?.message }, "Failed to fetch brand context, using defaults");
    return { name: "default", keywords: [] };
  }

  // Build keywords from brand profile fields
  const textFields = [data.product, data.core_offer, data.positioning, data.audience]
    .filter(Boolean)
    .join(" ");

  // Extract meaningful keywords (2+ character words, excluding generic stop words)
  const stopWords = new Set(["the", "and", "for", "with", "this", "that", "are", "you", "our", "we", "to", "in", "on", "at", "by", "is", "it", "of", "or", "be", "an", "as", "will", "do", "not", "but", "if", "from", "has", "have", "had", "what", "when", "where", "who", "which", "how", "all", "any", "can", "etc", "get", "your"]);

  const keywords = [...new Set(
    textFields
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  )];

  return {
    name: "brand",
    industry: data.product || undefined,
    keywords,
  };
}

/* ---- HELPER: Apply brand context to signal ---- */

function applyBrandContext(
  signal: Signal,
  brandContext: BrandContext
): { signal: Signal; score: { relevance_score: number; urgency_score: number; fit_reason: string } } {
  const score = matchOpportunity(signal, brandContext);
  return { signal, score };
}

/* ---- REDDIT EXECUTOR - UPDATED FOR END-CLIENT FOCUS ---- */

async function redditExecutor(params: ExecutorParams<z.infer<typeof redditSchema>>): Promise<DiscoveryResult> {
  const config = params.config;
  const brandContext = await getBrandContext(params.brandId);
   
  const posts = await fetchMultipleSubreddits(config.subreddits, config.limitPerSubreddit);

  const companies: DiscoveryCompany[] = posts.map(post => {
    const signal = extractSignal(post.body, post.title);
    const { score } = applyBrandContext(signal, brandContext);

    return {
      source: `reddit_${post.subreddit}`,
      source_url: post.url,
      risk: "medium_api",
      domain: `reddit.com/r/${post.subreddit}`,
      name: post.title,
      signal_type: signal.signal_type,
      relevance_score: score.relevance_score,
      urgency_score: score.urgency_score,
      fit_reason: score.fit_reason,
      summary: post.body.substring(0, 200),
    } as unknown as DiscoveryCompany;
  });

  return { companies, contacts: [] };
}

/* ---- HN EXECUTOR ---- */

async function hnExecutor(params: ExecutorParams<z.infer<typeof hnSchema>>): Promise<DiscoveryResult> {
  const config = params.config;
  const brandContext = await getBrandContext(params.brandId);
   
  const stories = await fetchHNStories(config.tags, undefined, config.hitsPerPage);

  const companies: DiscoveryCompany[] = stories.map(story => {
    const signal = extractSignal(story.story_text, story.title);
    const { score } = applyBrandContext(signal, brandContext);

    return {
      source: "hackernews",
      source_url: story.url,
      risk: "low_api",
      domain: "news.ycombinator.com",
      name: story.title,
      signal_type: signal.signal_type,
      relevance_score: score.relevance_score,
      urgency_score: score.urgency_score,
      fit_reason: score.fit_reason,
      summary: story.story_text?.substring(0, 200) || "",
    } as unknown as DiscoveryCompany;
  });

  return { companies, contacts: [] };
}

/* ---- INDIEHACKERS EXECUTOR ---- */

async function ihExecutor(params: ExecutorParams<z.infer<typeof ihSchema>>): Promise<DiscoveryResult> {
  const config = params.config;
  const brandContext = await getBrandContext(params.brandId);
   
  const posts = await fetchIndieHackersDiscussions(config.forumUrl, config.maxPosts);

  const companies: DiscoveryCompany[] = posts.map(post => {
    const signal = extractSignal(post.content, post.title);
    const { score } = applyBrandContext(signal, brandContext);

    return {
      source: "indiehackers",
      source_url: post.url,
      risk: "high_scrape",
      domain: "indiehackers.com",
      name: post.title,
      signal_type: signal.signal_type,
      relevance_score: score.relevance_score,
      urgency_score: score.urgency_score,
      fit_reason: score.fit_reason,
      summary: post.content?.substring(0, 200) || "",
    } as unknown as DiscoveryCompany;
  });

  return { companies, contacts: [] };
}

/* ---- REMOTEOK EXECUTOR ---- */

async function remoteokExecutor(params: ExecutorParams<z.infer<typeof remoteokSchema>>): Promise<DiscoveryResult> {
  const config = params.config;
  const brandContext = await getBrandContext(params.brandId);
   
  const jobs = await fetchRemoteOKJobs(config.limit);

  const companies: DiscoveryCompany[] = jobs.map(job => {
    const signal = extractSignal(job.description, job.title);
    const { score } = applyBrandContext(signal, brandContext);

    return {
      source: "remoteok",
      source_url: job.url,
      risk: "low_api",
      domain: job.company ? `${job.company.toLowerCase().replace(/\s+/g, '')}.com` : "remoteok.com",
      name: job.company || job.title,
      signal_type: signal.signal_type,
      relevance_score: score.relevance_score,
      urgency_score: score.urgency_score,
      fit_reason: score.fit_reason,
      summary: job.description?.substring(0, 200) || "",
    } as unknown as DiscoveryCompany;
  });

  return { companies, contacts: [] };
}

/* ---- PRODUCTHUNT EXECUTOR ---- */

async function phExecutor(params: ExecutorParams<z.infer<typeof phSchema>>): Promise<DiscoveryResult> {
  const config = params.config;
  const brandContext = await getBrandContext(params.brandId);
   
  const products = await fetchProductHuntRSS(config.maxItems);

  const companies: DiscoveryCompany[] = products.map(product => {
    const signal = extractSignal(product.tagline, product.name);
    const { score } = applyBrandContext(signal, brandContext);

    return {
      source: "producthunt",
      source_url: product.url,
      risk: "low_api",
      domain: "producthunt.com",
      name: product.name,
      signal_type: signal.signal_type,
      relevance_score: score.relevance_score,
      urgency_score: score.urgency_score,
      fit_reason: score.fit_reason,
      summary: product.tagline || "",
    } as unknown as DiscoveryCompany;
  });

  return { companies, contacts: [] };
}

/* =========================================================
     REGISTER SOURCE-DRIVEN EXECUTORS
========================================================= */

registerExecutor({
  type: "reddit",
  risk: "medium_api",
  cost: "low",
  requiresAuth: false,
  schema: redditSchema,
  execute: redditExecutor,
});

registerExecutor({
  type: "hackernews",
  risk: "low_api",
  cost: "low",
  requiresAuth: false,
  schema: hnSchema,
  execute: hnExecutor,
});

registerExecutor({
  type: "indiehackers",
  risk: "high_scrape",
  cost: "low",
  requiresAuth: false,
  schema: ihSchema,
  execute: ihExecutor,
});

registerExecutor({
  type: "remoteok",
  risk: "low_api",
  cost: "low",
  requiresAuth: false,
  schema: remoteokSchema,
  execute: remoteokExecutor,
});

registerExecutor({
  type: "producthunt",
  risk: "low_api",
  cost: "low",
  requiresAuth: false,
  schema: phSchema,
  execute: phExecutor,
});