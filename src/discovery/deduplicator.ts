import type { DiscoveryCompany, DiscoveryContact } from "./types"
import { normalizeDomain, normalizeEmail } from "./normalizer"

/* =========================================================
   DEDUPLICATION RESULT TYPES - ALIGNED WITH SUPABASE SCHEMA
========================================================= */

export interface DeduplicatedCompany {
  brand_id: string
  source_id: string | null
  name: string | null
  domain: string
  website: string | null
  raw_payload: unknown | null
  processed: boolean
  ingested: boolean
  dead_letter: boolean
  retry_count: number
  next_attempt_at: string | null
  error: string | null
  risk: "SAFE_API" | "MODERATE_PUBLIC" | "HIGH_SCRAPE" | null
  confidence: number | null
  intent_score: number | null
  requires_enrichment: boolean
  enrichment_status: "pending" | "locked" | "enriched" | "failed" | "dead"
  enrichment_attempts: number
  last_enrichment_at: string | null
  enrichment_source: string | null
  enrichment_reasoning: unknown | null
  enrichment_error: string | null
}

export interface DeduplicatedContact {
  brand_id: string
  source_id: string | null
  discovered_company_id: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  email: string | null
  title: string | null
  linkedin_url: string | null
  raw_payload: unknown | null
  processed: boolean
  ingested: boolean
  dead_letter: boolean
  retry_count: number
  next_attempt_at: string | null
  error: string | null
  domain: string | null
  risk: "SAFE_API" | "MODERATE_PUBLIC" | "HIGH_SCRAPE" | null
  confidence: number | null
  intent_score: number | null
  requires_enrichment: boolean
  enrichment_status: "pending" | "locked" | "enriched" | "failed" | "dead"
  enrichment_attempts: number
  last_enrichment_at: string | null
  enrichment_source: string | null
  enrichment_reasoning: unknown | null
  enrichment_error: string | null
}

/* =========================================================
   PLATFORM DOMAINS TO EXCLUDE
========================================================= */

const PLATFORM_DOMAINS = new Set([
  "github.com",
  "github.io",
  "gitlab.com",
  "gitlab.io",
  "bitbucket.org",
  "npmjs.com",
  "npm.io",
  "pypi.org",
  "pypi.io",
  "rubygems.org",
  "packagist.org",
  "crates.io",
  "nuget.org",
  "maven.org",
  "jekyllrb.com",
  "readthedocs.io",
  "readthedocs.org",
  "notion.so",
  "notion.site",
  "webflow.io",
  "wix.com",
  "squarespace.com",
  "shopify.com",
  "wordpress.com",
  "medium.com",
  "dev.to",
  "hashnode.com",
  "substack.com",
  "mailchimp.com",
  "heroku.com",
  "vercel.app",
  "netlify.app",
  "fly.dev",
  "surge.sh",
  "bleeding.study",
])

/* =========================================================
   DOMAIN VALIDATION
========================================================= */

export function isValidDomain(domain: string | null | undefined): boolean {
  if (!domain) return false
  const lower = domain.toLowerCase()
  if (PLATFORM_DOMAINS.has(lower)) return false
  if (lower.includes("github.io")) return false
  if (lower.endsWith(".github.io")) return false
  if (lower.includes("gitlab.io")) return false
  if (lower.endsWith(".gitlab.io")) return false
  return true
}

/* =========================================================
   GITHUB-SPECIFIC GROUPING
========================================================= */

interface GithubRepo {
  owner?: { login?: string; html_url?: string }
  homepage?: string | null
  name?: string
  html_url?: string
  description?: string | null
  fork?: boolean
  [key: string]: any
}

interface GroupedOrg {
  login: string
  name: string
  domain: string | null
  website: string | null
  bestRepo: GithubRepo
  maxStars: number
}

/**
 * Groups GitHub repos by organization (owner.login) and extracts ONE domain per org.
 * 
 * Priority for domain extraction:
 * 1. repo.homepage
 * 2. If owner has website metadata
 * 3. DROP (no valid business domain)
 */
export function groupGithubReposByOrg(repos: GithubRepo[]): GroupedOrg[] {
  const orgMap = new Map<string, GroupedOrg>()

  for (const repo of repos) {
    const login = repo.owner?.login
    if (!login) continue

    const existing = orgMap.get(login)
    const stars = repo.stargazers_count ?? 0

    if (!existing) {
      // First repo from this org
      const domain = normalizeDomain(repo.homepage ?? null)

      orgMap.set(login, {
        login,
        name: login,
        domain,
        website: repo.homepage ?? null,
        bestRepo: repo,
        maxStars: stars,
      })
    } else if (stars > existing.maxStars) {
      // Update if this repo has more stars (better data)
      const domain = normalizeDomain(repo.homepage ?? null)
      if (domain && (!existing.domain || stars > existing.maxStars * 0.5)) {
        orgMap.set(login, {
          ...existing,
          domain,
          website: repo.homepage ?? existing.website,
          bestRepo: repo,
          maxStars: stars,
        })
      }
    }
  }

  return Array.from(orgMap.values())
}

/* =========================================================
   DEDUPLICATE COMPANIES
========================================================= */

/**
 * Deduplicates companies by (brand_id, domain).
 * Keeps: highest confidence, then non-null website, then richer raw_payload.
 */
export function deduplicateCompanies(
  companies: DiscoveryCompany[],
  sourceId: string,
  brandId: string
): DeduplicatedCompany[] {
  const domainMap = new Map<string, DeduplicatedCompany>()

  for (const company of companies) {
    const domain = normalizeDomain(company.domain)
    if (!domain) continue
    if (!isValidDomain(domain)) continue

    const key = `${brandId}:${domain}`
    const existing = domainMap.get(key)

    if (!existing) {
      domainMap.set(key, {
        brand_id: brandId,
        source_id: sourceId,
        name: company.name ?? null,
        domain,
        website: (company as any).website ?? null,
        raw_payload: company.raw ?? null,
        processed: false,
        ingested: false,
        dead_letter: false,
        retry_count: 0,
        next_attempt_at: null,
        error: null,
        risk: (company.risk as "SAFE_API" | "MODERATE_PUBLIC" | "HIGH_SCRAPE") ?? null,
        confidence: company.confidence ?? null,
        intent_score: company.intent_score ?? null,
        requires_enrichment: company.requires_enrichment ?? true,
        enrichment_status: "pending",
        enrichment_attempts: 0,
        last_enrichment_at: null,
        enrichment_source: null,
        enrichment_reasoning: null,
        enrichment_error: null,
      })
    } else {
      const existingConf = existing.confidence ?? 0
      const newConf = company.confidence ?? 0

      if (newConf > existingConf) {
        domainMap.set(key, {
          ...existing,
          name: company.name ?? existing.name,
          website: (company as any).website ?? existing.website,
          raw_payload: company.raw ?? existing.raw_payload,
          confidence: newConf,
          intent_score: company.intent_score ?? existing.intent_score,
        })
      }
    }
  }

  return Array.from(domainMap.values())
}

/* =========================================================
   DEDUPLICATE CONTACTS
========================================================= */

/**
 * Deduplicates contacts by (brand_id, email).
 * Keeps: first occurrence with non-null full data.
 */
export function deduplicateContacts(
  contacts: DiscoveryContact[],
  sourceId: string,
  brandId: string,
  companyIdByDomain: Map<string, string>
): DeduplicatedContact[] {
  const emailMap = new Map<string, DeduplicatedContact>()

  for (const contact of contacts) {
    const domain = normalizeDomain(contact.domain)
    if (!domain) continue

    const discoveredCompanyId = companyIdByDomain.get(domain) ?? null

    const email = contact.email ? normalizeEmail(contact.email) : null

    if (!email) continue

    const key = `${brandId}:${email}`
    if (emailMap.has(key)) continue

    emailMap.set(key, {
      brand_id: brandId,
      source_id: sourceId,
      discovered_company_id: discoveredCompanyId,
      first_name: contact.first_name ?? null,
      last_name: contact.last_name ?? null,
      full_name: contact.full_name ?? null,
      email,
      title: contact.title ?? null,
      linkedin_url: contact.linkedin_url ?? null,
      raw_payload: contact.raw ?? null,
      processed: false,
      ingested: false,
      dead_letter: false,
      retry_count: 0,
      next_attempt_at: null,
      error: null,
      domain: domain,
      risk: (contact.risk as "SAFE_API" | "MODERATE_PUBLIC" | "HIGH_SCRAPE") ?? null,
      confidence: contact.confidence ?? null,
      intent_score: contact.intent_score ?? null,
      requires_enrichment: contact.requires_enrichment ?? true,
      enrichment_status: "pending",
      enrichment_attempts: 0,
      last_enrichment_at: null,
      enrichment_source: null,
      enrichment_reasoning: null,
      enrichment_error: null,
    })
  }

  return Array.from(emailMap.values())
}

/* =========================================================
   GITHUB REPO → COMPANY TRANSFORM
========================================================= */

/**
 * Transforms GitHub repos to companies, grouping by organization.
 * Returns companies with valid, unique business domains.
 */
export function transformGithubReposToCompanies(
  repos: GithubRepo[],
  sourceId: string,
  brandId: string
): DeduplicatedCompany[] {
  const groupedOrgs = groupGithubReposByOrg(repos)

  const companies: DeduplicatedCompany[] = []

  for (const org of groupedOrgs) {
    if (!org.domain) continue
    if (!isValidDomain(org.domain)) continue

    const repo = org.bestRepo
    companies.push({
      brand_id: brandId,
      source_id: sourceId,
      name: org.name,
      domain: org.domain,
      website: org.website,
      raw_payload: repo,
      processed: false,
      ingested: false,
      dead_letter: false,
      retry_count: 0,
      next_attempt_at: null,
      error: null,
      risk: "MODERATE_PUBLIC",
      confidence: Math.min((repo.stargazers_count ?? 0) / 10000, 1) || 0.7,
      intent_score: (repo.stargazers_count ?? 0) > 1000 ? 1 : 0.5,
      requires_enrichment: true,
      enrichment_status: "pending",
      enrichment_attempts: 0,
      last_enrichment_at: null,
      enrichment_source: null,
      enrichment_reasoning: null,
      enrichment_error: null,
    })
  }

  return companies
}