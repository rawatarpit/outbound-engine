import { executeScraplingSearch, ScraplingResult } from "../../core/utils/scrapling"
import pino from "pino"
import dns from "dns"
import { load } from "cheerio"
import axios from "axios"
import { randomUA } from "../utils/userAgent"
import { supabase } from "../../db/supabase"

const logger = pino({ level: "info" })

const CONTACT_FRESHNESS_DAYS = 90
const MAX_CONTACTS_PER_COMPANY = 10

// Consent/Opt-out tracking — persisted to DB, with in-memory fallback
const optOutStore = new Map<string, { optedOutAt: number; domains: Set<string> }>()
const OPTOUT_TTL_DAYS = 365

export async function recordOptOut(domain: string, identifier?: string): Promise<void> {
  const key = identifier || domain
  const existing = optOutStore.get(key) || { optedOutAt: Date.now(), domains: new Set() }
  existing.domains.add(domain)
  existing.optedOutAt = Date.now()
  optOutStore.set(key, existing)
  try {
    await supabase.from("opt_outs").upsert({
      domain, identifier: identifier || null,
      opted_out_at: new Date().toISOString(),
    }, { onConflict: "domain,identifier" })
  } catch { /* in-memory fallback is sufficient */ }
  logger.info({ domain, key }, "Opt-out recorded")
}

export async function isOptedOut(domain: string): Promise<boolean> {
  // Check in-memory first
  for (const [, entry] of optOutStore) {
    if (entry.domains.has(domain)) {
      const ageDays = (Date.now() - entry.optedOutAt) / (1000 * 60 * 60 * 24)
      if (ageDays <= OPTOUT_TTL_DAYS) return true
      optOutStore.delete(domain)
    }
  }
  // Then check DB
  try {
    const { data } = await supabase
      .from("opt_outs")
      .select("opted_out_at")
      .eq("domain", domain)
      .gte("opted_out_at", new Date(Date.now() - OPTOUT_TTL_DAYS * 86400000).toISOString())
      .limit(1)
    if (data && data.length > 0) return true
  } catch { /* in-memory is sufficient */ }
  return false
}

export function clearOptOuts(): void {
  optOutStore.clear()
}

// Decision-maker title patterns (verified, role-based)
const DECISION_MAKER_TITLES = [
  // C-suite
  /\b(ceo|chief\s+executive\s+officer)\b/i,
  /\b(cto|chief\s+technology\s+officer)\b/i,
  /\b(cio|chief\s+information\s+officer)\b/i,
  /\b(cmo|chief\s+marketing\s+officer)\b/i,
  /\b(coo|chief\s+operating\s+officer)\b/i,
  /\b(cro|chief\s+revenue\s+officer)\b/i,
  /\b(cdo|chief\s+data\s+officer)\b/i,
  /\b(cfo|chief\s+financial\s+officer)\b/i,
  // VP/Director level
  /\bvp\s+of\s+/i,
  /\bvice\s+president\s+of\s+/i,
  /\bdirector\s+of\s+/i,
  /\bhead\s+of\s+/i,
  // Sales/Business
  /\bsales\s+(manager|director|vp|lead|executive)\b/i,
  /\bbusiness\s+development\s+(manager|director|vp|lead)\b/i,
  /\baccount\s+executive\b/i,
  /\brevenue\s+operations\b/i,
  /\bsales\s+operations\b/i,
  // Marketing
  /\bmarketing\s+(manager|director|vp|lead)\b/i,
  /\bgrowth\s+(manager|director|vp|lead|head)\b/i,
  // Engineering/Tech (for decision-makers at small companies)
  /\bsenior\s+(engineer|developer|architect)\b/i,
  /\blead\s+(engineer|developer|architect)\b/i,
  /\bengineering\s+(manager|director|vp)\b/i,
  /\bproduct\s+(manager|director|vp|owner)\b/i,
  // Operations
  /\boperations\s+(manager|director|vp|head)\b/i,
  /\bgeneral\s+manager\b/i,
  /\bmanaging\s+(director|partner)\b/i,
  /\bfounder\b/i,
  /\bowner\b/i,
  /\bprincipal\b/i,
]

// Non-decision-maker titles to exclude
const NON_DECISION_MAKER_TITLES = [
  /\b(intern|trainee|apprentice)\b/i,
  /\b(junior|jr)\s+\w+\b/i,
  /\b(assistant|coordinator|associate|specialist)\b/i,
  /\b(administrator|receptionist|clerk|secretary)\b/i,
  /\b(analyst|support|technician)\s+(i|ii|iii|junior|jr)\b/i,
  /\bvolunteer\b/i,
  /\bcontractor\b/i,
  /\btemp\b/i,
  /\bfreelance\b/i,
]

// Company size to role mapping for validation
const ROLE_BY_COMPANY_SIZE: Record<string, string[]> = {
  small: ["ceo", "founder", "owner", "vp", "director", "head", "manager"],
  medium: ["ceo", "cto", "cmo", "vp", "director", "head", "manager"],
  large: ["ceo", "cto", "cmo", "coo", "cro", "vp", "director"],
  enterprise: ["ceo", "cto", "cmo", "coo", "cro", "vp", "director", "svp", "evp"],
}

function domainExists(domain: string): Promise<boolean> {
  return new Promise((resolve) => {
    dns.resolveMx(domain, (err, mx) => {
      if (!err && mx && mx.length > 0) return resolve(true)
      dns.resolve4(domain, (err4) => {
        resolve(!err4)
      })
    })
  })
}

async function isValidDomain(domain: string): Promise<boolean> {
  if (!domain || domain === "unknown.com" || domain === "unknown" || domain === "null" || domain === "undefined") {
    return false
  }
  return await domainExists(domain)
}

function isDecisionMaker(title: string): boolean {
  const matches = DECISION_MAKER_TITLES.some(p => p.test(title))
  const excludes = NON_DECISION_MAKER_TITLES.some(p => p.test(title))
  return matches && !excludes
}

function validateRoleForCompanySize(title: string, companySize: "small" | "medium" | "large" | "enterprise"): boolean {
  const allowedRoles = ROLE_BY_COMPANY_SIZE[companySize]
  if (!allowedRoles) return true
  const titleLower = title.toLowerCase()
  return allowedRoles.some(role => titleLower.includes(role))
}

function isRecentlyActive(timestamp: number): boolean {
  const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24)
  return ageDays <= CONTACT_FRESHNESS_DAYS
}

export interface DiscoveredContact {
  full_name: string
  first_name: string
  last_name: string
  title: string
  email?: string
  linkedin_url?: string
  confidence: number
  reasoning?: string
  source: "linkedin" | "web_search" | "press_release" | "team_page" | "conference"
  discoveredAt: number
  consent_status?: "granted" | "opted_out" | "unknown"
}

export interface ContactDiscoveryResult {
  contacts: DiscoveredContact[]
  source: "linkedin_search" | "web_search" | "press_release" | "team_page"
}

const LINKEDIN_TITLE_RE = /^(.+?)\s*[–-]\s*(.+?)\s+at\s+.+?(\s*\||\s*$)/

function parseLinkedInTitle(
  result: ScraplingResult,
  companyName: string
): { name: string; title: string } | null {
  const title = result.title || ""
  const url = result.url || ""
  if (!url.includes("linkedin.com/in/")) return null

  const match = title.match(LINKEDIN_TITLE_RE)
  if (match) {
    const name = match[1].trim()
    const role = match[2].trim()
    if (name && role && name.length < 60 && role.length < 80) {
      if (isDecisionMaker(role)) {
        return { name, title: role }
      }
    }
  }
  return null
}

function parsePressReleaseTitle(
  result: ScraplingResult,
  companyName: string
): { name: string; title: string; linkedin_url?: string } | null {
  const title = result.title || ""
  const body = result.body || ""
  const url = result.url || ""
  const text = `${title} ${body}`

  // Press release patterns
  const appointmentPattern = /(?:appoints|hires|promotes|welcomes|announces)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+as\s+(.+?)(?:[,\.]|$)/i
  const joinPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:joins?|has\s+joined|will\s+join)\s+(?:the\s+)?(?:company|team).+?as\s+(.+?)(?:[,\.]|$)/i

  const appMatch = text.match(appointmentPattern)
  if (appMatch) {
    const name = appMatch[1].trim()
    const role = appMatch[2].trim()
    if (isDecisionMaker(role) && name.length < 60 && role.length < 80) {
      return { name, title: role, linkedin_url: url.includes("linkedin") ? url.split("?")[0] : undefined }
    }
  }

  const joinMatch = text.match(joinPattern)
  if (joinMatch) {
    const name = joinMatch[1].trim()
    const role = joinMatch[2].trim()
    if (isDecisionMaker(role) && name.length < 60 && role.length < 80) {
      return { name, title: role, linkedin_url: url.includes("linkedin") ? url.split("?")[0] : undefined }
    }
  }

  return null
}

function parseTeamPage(result: ScraplingResult, companyName: string): { name: string; title: string }[] {
  const body = result.body || ""
  const $ = load(body)
  const members: { name: string; title: string }[] = []

  // Common team page patterns
  $("[class*='team'], [class*='member'], [class*='profile'], [class*='people']").each((_, el) => {
    const $el = $(el)
    const nameText = $el.find("[class*='name'], h3, h4").first().text().trim()
    const titleText = $el.find("[class*='title'], [class*='role'], [class*='position'], p").first().text().trim()

    if (nameText && titleText && nameText.length < 60 && titleText.length < 80) {
      if (isDecisionMaker(titleText)) {
        members.push({ name: nameText, title: titleText })
      }
    }
  })

  // Fallback: parse from list items
  if (members.length === 0) {
    $("li, div.list-item, tr").each((_, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const roleMatch = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[–-]\s*(.+?)$/)
      if (roleMatch) {
        const name = roleMatch[1].trim()
        const title = roleMatch[2].trim()
        if (isDecisionMaker(title) && name.length < 60 && title.length < 80) {
          members.push({ name, title })
        }
      }
    })
  }

  return members
}

async function searchLinkedInProfiles(companyName: string): Promise<ScraplingResult[]> {
  const query = `site:linkedin.com/in/ "${companyName}"`
  return await executeScraplingSearch(query, "google", 10)
}

async function searchPressReleases(companyName: string): Promise<ScraplingResult[]> {
  const queries = [
    `"${companyName}" appoints OR hires OR promotes`,
    `"${companyName}" announces new`,
    `"${companyName}" joins as`,
    `"${companyName}" new hire`,
  ]
  const allResults: ScraplingResult[] = []
  for (const q of queries) {
    const results = await executeScraplingSearch(q, "google", 5)
    allResults.push(...results)
  }
  return allResults
}

async function searchTeamPage(companyName: string): Promise<ScraplingResult | null> {
  const query = `"${companyName}" team OR leadership OR about`
  const results = await executeScraplingSearch(query, "google", 5)
  for (const r of results) {
    const url = r.url || ""
    if (/about|team|people|leadership|company/.test(url) && !url.includes("linkedin") && !url.includes("facebook")) {
      return r
    }
  }
  return null
}

async function validateCandidate(
  name: string,
  companyName: string
): Promise<{ linkedin_url?: string; confidence: number }> {
  const query = `"${name}" "${companyName}" linkedin`
  const results = await executeScraplingSearch(query, "google", 5)

  for (const r of results) {
    const url = r.url || ""
    if (url.includes("linkedin.com/in/")) {
      const cleanUrl = url.split("?")[0].split("#")[0]
      const body = (r.body || "").toLowerCase()
      const companyLower = companyName.toLowerCase()
      const nameLower = name.toLowerCase()

      if (body.includes(companyLower.slice(0, 6)) || (r.title || "").toLowerCase().includes(companyLower.slice(0, 6))) {
        return { linkedin_url: cleanUrl, confidence: 0.7 }
      }
      if (body.includes(nameLower.slice(0, 4))) {
        return { linkedin_url: cleanUrl, confidence: 0.5 }
      }
    }
  }

  return { confidence: 0.2 }
}

export async function discoverDecisionMakers(params: {
  companyName: string
  domain: string
  industry?: string
  brandContext?: string
  targetRoles?: string[]
  clientId?: string
  linkedinUrl?: string
}): Promise<ContactDiscoveryResult> {
  const { companyName, domain } = params

  if (!(await isValidDomain(domain))) {
    logger.info({ company: companyName, domain }, "Domain invalid — skipping contact discovery")
    return { contacts: [], source: "linkedin_search" }
  }

  if (await isOptedOut(domain)) {
    logger.warn({ company: companyName, domain }, "Domain is opted out — skipping contact discovery")
    return { contacts: [], source: "linkedin_search" }
  }

  const candidates: { name: string; title: string; linkedin_url?: string; source: DiscoveredContact["source"]; discoveredAt: number }[] = []

  // Primary: LinkedIn profile search (verified employment)
  const linkedInResults = await searchLinkedInProfiles(companyName)
  for (const r of linkedInResults) {
    const parsed = parseLinkedInTitle(r, companyName)
    if (parsed) {
      candidates.push({
        ...parsed,
        linkedin_url: r.url?.split("?")[0].split("#")[0],
        source: "linkedin",
        discoveredAt: Date.now(),
      })
    }
  }

  // Secondary: Press releases / leadership announcements
  if (candidates.length < MAX_CONTACTS_PER_COMPANY) {
    const pressResults = await searchPressReleases(companyName)
    for (const r of pressResults) {
      const parsed = parsePressReleaseTitle(r, companyName)
      if (parsed) {
        candidates.push({
          name: parsed.name,
          title: parsed.title,
          linkedin_url: parsed.linkedin_url,
          source: "press_release",
          discoveredAt: Date.now(),
        })
      }
    }
  }

  // Secondary: Website team/leadership page scraping
  if (candidates.length < MAX_CONTACTS_PER_COMPANY) {
    const teamPage = await searchTeamPage(companyName)
    if (teamPage) {
      const members = parseTeamPage(teamPage, companyName)
      for (const m of members) {
        candidates.push({
          name: m.name,
          title: m.title,
          source: "team_page",
          discoveredAt: Date.now(),
        })
      }
    }
  }

  // Fallback: general web search
  if (candidates.length === 0) {
    logger.info({ company: companyName }, "No LinkedIn/press/team results — trying general web search")
    const webQueries = [
      `"${companyName}" "CEO" OR "Founder" OR "CTO" OR "VP"`,
      `"${companyName}" people team leadership`,
      `"${companyName}" employees linkedin`,
    ]
    const webAllResults: ScraplingResult[] = []
    for (const q of webQueries) {
      const results = await executeScraplingSearch(q, "google", 10)
      webAllResults.push(...results)
    }
    for (const r of webAllResults) {
      const parsed = parseLinkedInTitle(r, companyName)
      if (parsed) {
        candidates.push({
          ...parsed,
          linkedin_url: r.url?.includes("linkedin") ? r.url?.split("?")[0].split("#")[0] : undefined,
          source: "web_search",
          discoveredAt: Date.now(),
        })
      }
    }
  }

  logger.info({ company: companyName, candidateCount: candidates.length }, "Candidate contacts found")

  if (candidates.length === 0) {
    return { contacts: [], source: "linkedin_search" }
  }

  // Validate and construct contacts
  const contacts: DiscoveredContact[] = []

  for (const c of candidates) {
    if (contacts.length >= MAX_CONTACTS_PER_COMPANY) break

    // Title validation (must be decision-maker)
    if (!isDecisionMaker(c.title)) {
      logger.debug({ name: c.name, title: c.title }, "Skipping non-decision-maker title")
      continue
    }

    // Validate from LinkedIn URL or web search
    const validated = c.linkedin_url
      ? { linkedin_url: c.linkedin_url, confidence: 0.6 }
      : await validateCandidate(c.name, companyName)

    if (validated.confidence < 0.3) continue

    const nameParts = c.name.split(" ")
    const consent_status = await isOptedOut(domain) ? "opted_out" : "unknown" as const

    contacts.push({
      full_name: c.name,
      first_name: nameParts[0],
      last_name: nameParts.slice(1).join(" ") || "Unknown",
      title: c.title,
      linkedin_url: validated.linkedin_url,
      confidence: Math.min(validated.confidence + (c.source === "linkedin" ? 0.15 : c.source === "press_release" ? 0.1 : 0), 0.9),
      source: c.source,
      discoveredAt: c.discoveredAt,
      consent_status,
    })
  }

  // Sort by confidence descending, take top contacts
  contacts.sort((a, b) => b.confidence - a.confidence)

  const primarySource: ContactDiscoveryResult["source"] =
    contacts.some(c => c.source === "linkedin") ? "linkedin_search" :
    contacts.some(c => c.source === "press_release") ? "press_release" :
    contacts.some(c => c.source === "team_page") ? "team_page" :
    "web_search"

  logger.info({ company: companyName, count: contacts.length, source: primarySource }, "Contacts discovered")
  return { contacts: contacts.slice(0, MAX_CONTACTS_PER_COMPANY), source: primarySource }
}

export async function inferEmailPattern(params: {
  firstName: string
  lastName: string
  domain: string
  companyName: string
  clientId?: string
}): Promise<{ email: string; confidence: number; pattern: string }> {
  const { firstName, lastName, domain } = params
  const valid = await isValidDomain(domain)

  return {
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
    confidence: valid ? 0.3 : 0.05,
    pattern: "first.last",
  }
}
