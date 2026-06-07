import pino from "pino"
import { Signal, SignalType } from "./signal-extractor"
import { OpportunityScore } from "./opportunity-matcher"

const logger = pino({ level: "debug" })

export interface NormalizedOpportunity {
  title: string
  company: string
  source: string
  signal_type: string
  summary: string
  url: string
  domain: string
  relevance_score: number
  urgency_score: number
  fit_reason: string
  job_title?: string
  linkedin_url?: string
  timestamp?: number
}

export function normalizeOpportunity(params: {
  title: string
  company?: string
  source: string
  signal: Signal
  score: OpportunityScore
  url: string
  domain?: string
  summary?: string
  job_title?: string
  linkedin_url?: string
  timestamp?: number
}): NormalizedOpportunity {
  const {
    title,
    company = "",
    source,
    signal,
    score,
    url,
    domain,
    summary,
    job_title,
    linkedin_url,
    timestamp
  } = params

  const normalized: NormalizedOpportunity = {
    title: title.slice(0, 255),
    company: company.slice(0, 100),
    source,
    signal_type: signal.signal_type,
    summary: (summary || signal.raw_text).slice(0, 500),
    url: url.slice(0, 500),
    domain: domain ? domain.slice(0, 255) : url.slice(0, 255),
    relevance_score: score.relevance_score,
    urgency_score: score.urgency_score,
    fit_reason: score.fit_reason.slice(0, 500),
    job_title,
    linkedin_url: linkedin_url?.slice(0, 500),
    timestamp
  }

  return normalized
}

export function normalizeRedditPost(
  post: any,
  signal: Signal,
  score: OpportunityScore
): NormalizedOpportunity {
  return normalizeOpportunity({
    title: post.title || "Reddit Post",
    company: post.author || "",
    source: `reddit_${post.subreddit || "unknown"}`,
    signal,
    score,
    url: post.url || "",
    summary: `${post.title} ${post.body || ""}`.trim(),
    timestamp: post.timestamp
  })
}

export function normalizeHNStory(
  story: any,
  signal: Signal,
  score: OpportunityScore
): NormalizedOpportunity {
  return normalizeOpportunity({
    title: story.title || "HN Story",
    company: story.author || "",
    source: "hackernews",
    signal,
    score,
    url: story.url || "",
    summary: `${story.title} ${story.story_text || ""}`.trim(),
    timestamp: story.timestamp
  })
}

export function normalizeIHPost(
  post: any,
  signal: Signal,
  score: OpportunityScore
): NormalizedOpportunity {
  return normalizeOpportunity({
    title: post.title || "IH Post",
    company: post.author || "",
    source: "indiehackers",
    signal,
    score,
    url: post.url || "",
    summary: `${post.title} ${post.content || ""}`.trim(),
    timestamp: post.timestamp
  })
}

export function normalizeRemoteOKJob(
  job: any,
  signal: Signal,
  score: OpportunityScore
): NormalizedOpportunity {
  return normalizeOpportunity({
    title: job.title || "Remote Job",
    company: job.company || "",
    source: "remoteok",
    signal,
    score,
    url: job.url || "",
    summary: `${job.title} ${job.description || ""}`.trim(),
    timestamp: job.timestamp
  })
}

export function normalizePHProduct(
  product: any,
  signal: Signal,
  score: OpportunityScore
): NormalizedOpportunity {
  return normalizeOpportunity({
    title: product.name || "PH Product",
    company: "",
    source: "producthunt",
    signal,
    score,
    url: product.url || "",
    summary: `${product.name} ${product.tagline || ""}`.trim(),
    timestamp: product.timestamp
  })
}

export function batchNormalize(
  items: any[],
  source: string,
  signalExtractor: (item: any) => Signal,
  scorer: (signal: Signal) => OpportunityScore,
  normalizer: (item: any, signal: Signal, score: OpportunityScore) => NormalizedOpportunity
): NormalizedOpportunity[] {
  return items.map(item => {
    const signal = signalExtractor(item)
    const score = scorer(signal)
    return normalizer(item, signal, score)
  })
}
