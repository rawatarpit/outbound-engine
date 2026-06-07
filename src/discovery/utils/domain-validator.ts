import dns from "dns"
import { promisify } from "util"
import pino from "pino"

const logger = pino({ level: "debug" })
const resolveMx = promisify(dns.resolveMx)

const AGGREGATOR_NAMES = new Set([
  "naukri", "indeed", "glassdoor", "linkedin", "upwork", "jooble",
  "simplyhired", "monster", "ziprecruiter", "careerbuilder", "snagaajob",
  "trabajo", "jobz", "jobstreet", "xing", "freelancer", "fiverr",
  "toptal", "angel.co", "wellfound", "dice", "roberthalf",
  "randstad", "adecco", "kelly", "manpower",
])

const AGGREGATOR_DOMAINS = new Set([
  "flexjobs.com", "zippia.com", "apna.co", "workingnomads.com",
  "virtualvocations.com", "totaljobs.com", "shine.com",
  "internshala.com", "salesdevjobs.com", "iimjobs.com",
  "salesstaffingagency.com", "recruiters.com", "nspdmall.com",
  "monster.com", "careerbuilder.com", "dice.com", "indeed.com",
  "glassdoor.com", "simplyhired.com", "ziprecruiter.com",
  "jobstreet.com", "naukri.com", "jooble.com",
  "upwork.com", "freelancer.com", "fiverr.com", "toptal.com",
  "builtin.com", "builtin.io", "velvetjobs.com", "erekrut.com",
  "placementindia.com", "quikr.com", "truelancer.com",
  "interviewguy.com", "salesso.com", "wellfound.com", "angel.co",
  "vietnamworks.com", "joingenius.com", "igamingrecruitment.io",
  "salesleopard.com", "adaface.com", "signalhire.com",
  "chatterworks.com", "leadhaste.com", "salesfolks.com",
  "exceedsales.com", "salesfocusinc.com",
  "simplyhired.co.in",
])

const FEATURE_WORDS = new Set([
  "automation", "outbound", "software", "platform", "solution", "tool",
  "saas", "service", "solutions", "system", "systems", "app", "application",
  "technology", "tech", "digital", "data", "cloud", "network",
])

export async function domainHasEmail(domain: string): Promise<boolean> {
  try {
    const mx = await resolveMx(domain)
    return mx && mx.length > 0
  } catch {
    return false
  }
}

const HALLUCINATION_PATTERNS = [
  /site:\S+/i,
  /subreddit:\S+/i,
  /\bOR\b/,
  /"[^"]{10,}"/,
  /^\w{1,4}\s+\w{1,4}\s+\w{1,4}\s+\w{1,4}\s+\w{1,4}/,
]

export function isLikelyRealCompanyName(name: string): boolean {
  const trimmed = name.trim()

  if (trimmed.length < 2) return false

  if (trimmed.length > 80) return false

  if (trimmed.split(/\s+/).length === 1 && trimmed.length < 6) {
    return false
  }

  if (FEATURE_WORDS.has(trimmed.toLowerCase())) return false

  if (/\[.*\]/.test(trimmed)) return false

  if (/^[a-z0-9]{1,4}$/i.test(trimmed)) return false

  if (HALLUCINATION_PATTERNS.some(p => p.test(trimmed))) return false

  return true
}

export function isAggregatorByName(name: string): boolean {
  const lower = name.toLowerCase()
  return [...AGGREGATOR_NAMES].some(n => lower.includes(n))
}

export function isAggregatorByDomain(domain: string): boolean {
  return AGGREGATOR_DOMAINS.has(domain.toLowerCase())
}

export async function qualifyDiscoveredCompany(
  company: { name: string; domain?: string; confidence: number }
): Promise<"pass" | "reject" | "uncertain"> {
  if (!isLikelyRealCompanyName(company.name)) {
    logger.debug({ company: company.name }, "Name quality gate: rejected")
    return "reject"
  }

  if (isAggregatorByName(company.name)) {
    logger.debug({ company: company.name }, "Aggregator name gate: rejected")
    return "reject"
  }

  if (company.domain && company.domain !== "unknown.com") {
    if (isAggregatorByDomain(company.domain)) {
      logger.debug({ company: company.name, domain: company.domain }, "Aggregator domain gate: rejected")
      return "reject"
    }

    const hasMx = await domainHasEmail(company.domain)
    if (!hasMx) {
      logger.debug({ company: company.name, domain: company.domain }, "MX record gate: rejected")
      return "reject"
    }
  }

  if (company.confidence < 0.3) {
    logger.debug({ company: company.name, confidence: company.confidence }, "Low confidence: uncertain")
    return "uncertain"
  }

  return "pass"
}
