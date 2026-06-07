import pino from "pino"
import { Signal, SignalType } from "./signal-extractor"

const logger = pino({ level: "debug" })

export interface PreValidationResult {
  passed: boolean
  serviceProviderRisk: "low" | "medium" | "high"
  geographicMatch: boolean
  firmographicFit: "good" | "poor" | "unknown"
  signalQuality: number
  revenueIndication: "likely" | "unlikely" | "unknown"
  contactInfoPresent: boolean
  rejectionReasons: string[]
}

/* =========================================================
   1. SERVICE PROVIDER FILTER
   ========================================================= */

const PROVIDER_TLDS = new Set([
  ".agency", ".studio", ".dev", ".services", ".solutions", ".consulting",
  ".ventures", ".digital", ".media", ".marketing", ".technology",
  ".management", ".company", ".enterprises", ".industries",
  ".systems", ".network", ".global", ".international",
])

const KNOWN_AGGREGATOR_PLATFORMS = new Set([
  "producthunt.com", "crunchbase.com", "angel.co", "wellfound.com",
  "linkedin.com", "indeed.com", "glassdoor.com", "upwork.com",
  "fiverr.com", "freelancer.com", "toptal.com", "peopleperhour.com",
  "guru.com", "remoteok.com", "weworkremotely.com", "flexjobs.com",
  "builtin.com", "stackoverflow.com", "quora.com", "medium.com",
  "dev.to", "hashnode.com", "indiehackers.com", "hackernews.com",
  "news.ycombinator.com", "producthunt.com",
])

const PROVIDER_CONTENT_INDICATORS = [
  "we offer", "we provide", "we build", "we create", "we develop",
  "our services", "our solutions", "our products", "we specialize in",
  "we help companies", "we work with clients", "our team of experts",
  "years of experience", "proven track record", "trusted by",
  "award winning", "leading provider", "top rated", "best in class",
  "contact us", "get a quote", "schedule a consultation",
  "our portfolio", "our clients", "case studies", "testimonials",
  "book a demo", "talk to sales", "request a demo",
]

function checkServiceProvider(domain: string | undefined, signal: Signal): { risk: "low" | "medium" | "high"; reasons: string[] } {
  const reasons: string[] = []

  if (domain) {
    if (PROVIDER_TLDS.has(domain)) {
      reasons.push(`Provider TLD detected: ${domain}`)
    }
    if (KNOWN_AGGREGATOR_PLATFORMS.has(domain)) {
      reasons.push(`Known aggregator/platform domain: ${domain}`)
    }
    const domainParts = domain.split(".")
    if (domainParts.length >= 2) {
      const baseName = domainParts[domainParts.length - 2]
      if (/agency|studio|consult|solution|service|partner/i.test(baseName)) {
        reasons.push(`Domain name suggests provider: ${baseName}`)
      }
    }
  }

  const contentMatchCount = PROVIDER_CONTENT_INDICATORS.reduce((count, indicator) => {
    return signal.raw_text.toLowerCase().includes(indicator) ? count + 1 : count
  }, 0)

  if (contentMatchCount >= 3) {
    reasons.push(`Strong provider language (${contentMatchCount} indicators)`)
  } else if (contentMatchCount >= 1) {
    reasons.push(`Some provider language (${contentMatchCount} indicators)`)
  }

  if (signal.intent === "provider" && signal.confidence_score > 0.6) {
    reasons.push(`High-confidence provider intent (${signal.confidence_score.toFixed(2)})`)
  }

  const risk: "low" | "medium" | "high" =
    reasons.length >= 2 ? "high" :
    reasons.length >= 1 ? "medium" : "low"

  return { risk, reasons }
}

/* =========================================================
   2. GEOGRAPHIC VALIDATION
   ========================================================= */

const TARGET_REGIONS = [
  { name: "uae", patterns: [/dubai/i, /uae/i, /united arab emirates/i, /abu dhabi/i, /sharjah/i, /\.ae\b/] },
  { name: "uk", patterns: [/uk\b/i, /united kingdom/i, /england/i, /scotland/i, /wales/i, /northern ireland/i, /london/i, /\.uk\b/] },
  { name: "germany", patterns: [/germany/i, /deutschland/i, /berlin/i, /munich/i, /hamburg/i, /frankfurt/i, /\.de\b/] },
  { name: "france", patterns: [/france/i, /paris/i, /lyon/i, /marseille/i, /\.fr\b/] },
  { name: "netherlands", patterns: [/netherlands/i, /holland/i, /amsterdam/i, /rotterdam/i, /\.nl\b/] },
  { name: "spain", patterns: [/spain/i, /españa/i, /madrid/i, /barcelona/i, /\.es\b/] },
  { name: "italy", patterns: [/italy/i, /italia/i, /rome/i, /milan/i, /\.it\b/] },
  { name: "sweden", patterns: [/sweden/i, /sverige/i, /stockholm/i, /\.se\b/] },
  { name: "norway", patterns: [/norway/i, /norge/i, /oslo/i, /\.no\b/] },
  { name: "denmark", patterns: [/denmark/i, /danmark/i, /copenhagen/i, /\.dk\b/] },
  { name: "finland", patterns: [/finland/i, /suomi/i, /helsinki/i, /\.fi\b/] },
  { name: "belgium", patterns: [/belgium/i, /brussels/i, /\.be\b/] },
  { name: "austria", patterns: [/austria/i, /vienna/i, /\.at\b/] },
  { name: "switzerland", patterns: [/switzerland/i, /zurich/i, /geneva/i, /\.ch\b/] },
  { name: "ireland", patterns: [/ireland/i, /dublin/i, /\.ie\b/] },
  { name: "us", patterns: [/united states/i, /usa\b/i, /new york/i, /california/i, /texas/i, /florida/i, /\.us\b/] },
  { name: "canada", patterns: [/canada/i, /toronto/i, /vancouver/i, /montreal/i, /\.ca\b/] },
]

const TARGET_TLDS = new Set([
  ".ae", ".uk", ".de", ".fr", ".nl", ".es", ".it", ".se", ".no", ".dk",
  ".fi", ".be", ".at", ".ch", ".pl", ".cz", ".ie", ".us", ".ca",
])

const GENERIC_TLDS = new Set([
  ".com", ".org", ".net", ".io", ".app", ".co", ".ai", ".dev", ".info",
  ".biz", ".online", ".site", ".tech", ".xyz", ".live", ".pro",
])

function checkGeographic(domain: string | undefined, signal: Signal): { match: boolean; matchedRegions: string[] } {
  const textToCheck = `${signal.raw_text || ""} ${domain || ""}`
  const matchedRegions: string[] = []

  for (const region of TARGET_REGIONS) {
    for (const pattern of region.patterns) {
      if (pattern.test(textToCheck)) {
        matchedRegions.push(region.name)
        break
      }
    }
  }

  if (domain) {
    const domainLower = domain.toLowerCase()
    for (const tld of TARGET_TLDS) {
      if (domainLower.endsWith(tld)) {
        const regionName = TARGET_REGIONS.find(r => r.patterns.some(p => p.source.includes(tld.replace(".", "\\."))))
        if (regionName && !matchedRegions.includes(regionName.name)) {
          matchedRegions.push(regionName.name)
        }
        break
      }
    }
  }

  // Generic TLDs (no explicit geo signal) are treated as "global" — not a rejection
  if (matchedRegions.length === 0 && domain) {
    const domainLower = domain.toLowerCase()
    const hasGenericTld = [...GENERIC_TLDS].some(tld => domainLower.endsWith(tld))
    const noExplicitGeo = !signal.raw_text || ![...TARGET_REGIONS.flatMap(r => r.patterns)].some(p => p.test(signal.raw_text))
    if (hasGenericTld && noExplicitGeo) {
      return { match: true, matchedRegions: ["global"] }
    }
  }

  return { match: matchedRegions.length > 0, matchedRegions }
}

/* =========================================================
   3. FIRMOGRAPHIC ESTIMATION
   ========================================================= */

const ENTERPRISE_INDICATORS = [
  /fortune\s+500/i, /global\s+leader/i, /multinational/i,
  /enterprise/i, /corporation/i, /incorporated/i, /inc\.?\b/i,
  /ltd\b/i, /limited/i, /plc\b/i, /group\s+holdings/i,
  /headquarters/i, /hq\b/i, /subsidiary/i, /publicly\s+traded/i,
  /nasdaq/i, /nyse\b/i,
]

const SMALL_BIZ_INDICATORS = [
  /freelancer/i, /solopreneur/i, /independent\s+contractor/i,
  /self-?employed/i, /one\s+person/i, /sole\s+proprietor/i,
  /side\s+hustle/i, /startup/i,
]

const EMPLOYEE_SIZE_PATTERNS = [
  /(?:we\s+(?:are\s+)?|our\s+team\s+(?:of\s+)?|(?:a|an)\s+)(\d+)\s*(?:-|\s+to\s+)?(\d+)?\s*(?:people|person|employees?|staff|team\s+members?)/i,
  /(?:team\s+of\s+|staff\s+of\s+)(\d+)\s*(?:-|\s+to\s+)?(\d+)?/i,
  /(\d+)\s*(?:-|\s+to\s+)?(\d+)?\s*(?:people|person|employees?|staff)\s+(?:team|strong)/i,
  /(?:grown\s+to\s+|expanded\s+to\s+|now\s+at\s+)(\d+)\s*(?:-|\s+to\s+)?(\d+)?\s*(?:people|person|employees?)/i,
]

const B2B_INDUSTRY_INDICATORS = [
  /b2b\b/i, /business\s+to\s+business/i, /manufacturing/i,
  /healthcare/i, /finance\b/i, /banking/i, /insurance/i,
  /retail/i, /ecommerce/i, /logistics/i, /supply\s+chain/i,
  /real\s+estate/i, /education/i, /nonprofit/i, /government/i,
  /municipal/i, /construction/i, /transportation/i,
  /hospitality/i, /food\s+(and|&)\s+beverage/i,
]

const PURE_TECH_INDICATORS = [
  /software\s+company/i, /saas\s+company/i, /tech\s+startup/i,
  /app\s+developer/i, /game\s+developer/i, /software\s+product/i,
  /tech\s+product/i, /software\s+vendor/i, /it\s+company/i,
  /software\s+house/i, /dev\s+agency/i, /development\s+agency/i,
]

interface FirmographicEstimate {
  fit: "good" | "poor" | "unknown"
  employeeCount: number | null
  industry: string | null
  reasons: string[]
}

function estimateFirmographics(domain: string | undefined, signal: Signal): FirmographicEstimate {
  const text = `${domain || ""} ${signal.raw_text || ""}`
  const reasons: string[] = []

  const enterpriseScore = ENTERPRISE_INDICATORS.reduce((s, p) => p.test(text) ? s + 1 : s, 0)
  if (enterpriseScore >= 2) {
    reasons.push(`Enterprise indicators (score: ${enterpriseScore})`)
    return { fit: "poor", employeeCount: null, industry: null, reasons }
  }

  const smallBizScore = SMALL_BIZ_INDICATORS.reduce((s, p) => p.test(text) ? s + 1 : s, 0)
  if (smallBizScore >= 1) {
    reasons.push(`Small biz/solopreneur indicators (score: ${smallBizScore})`)
    return { fit: "poor", employeeCount: null, industry: null, reasons }
  }

  let employeeCount: number | null = null
  for (const pattern of EMPLOYEE_SIZE_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      const num = parseInt(match[1])
      if (!isNaN(num)) {
        employeeCount = num
        reasons.push(`Employee count estimated: ~${num}`)
        break
      }
    }
  }

  if (employeeCount !== null) {
    if (employeeCount < 5) {
      reasons.push(`Too small (${employeeCount})`)
      return { fit: "poor", employeeCount, industry: null, reasons }
    }
    if (employeeCount > 1000) {
      reasons.push(`Too large (${employeeCount})`)
      return { fit: "poor", employeeCount, industry: null, reasons }
    }
  }

  const pureTechScore = PURE_TECH_INDICATORS.reduce((s, p) => p.test(text) ? s + 1 : s, 0)
  if (pureTechScore >= 2) {
    reasons.push(`Pure tech/product company (score: ${pureTechScore}) — OK for product engineering services`)
  }

  const b2bScore = B2B_INDUSTRY_INDICATORS.reduce((s, p) => p.test(text) ? s + 1 : s, 0)
  if (b2bScore >= 1) {
    reasons.push(`B2B industry indicators (score: ${b2bScore})`)
    return { fit: "good", employeeCount, industry: "b2b", reasons }
  }

  return { fit: employeeCount !== null ? "good" : "unknown", employeeCount, industry: null, reasons }
}

/* =========================================================
   4. SIGNAL QUALITY SCORING
   ========================================================= */

const SPECIFICITY_INDICATORS = [
  /(?:specifically|exactly|precisely)\s+(?:need|looking|want)/i,
  /(?:our\s+)?(?:budget|spend|investment)\s+(?:is|of|for)\s+/i,
  /(?:current|existing)\s+(?:tech\s+stack|system|platform|tool|process)/i,
  /(?:we\s+)?(?:use|run|operate)\s+/i,
  /(?:number|count|amount|volume)\s+(?:of|is)\s+/i,
  /\$\d+[kbm]?\b/i,
  /\d+%\s+(?:of|faster|more|better)/i,
]

const RECENCY_INDICATORS = [
  /(?:this|next|current)\s+(?:quarter|month|week|year)/i,
  /q[1-4]\s+\d{4}/i,
  /(?:launching|releasing|shipping|deploying)\s+(?:next|this|in)/i,
  /(?:immediately|urgently|asap|as soon as possible)/i,
  /(?:by|before|until)\s+(?:\w+\s+\d{1,2})/i,
  /\d{4}-\d{2}-\d{2}/,
  /(?:deadline|due\s+date|timeline)/i,
]

const AUTHORITY_INDICATORS = [
  /(?:vp|director|head|chief|senior\s+(?:vp|director|manager)|cto|cio|cmo|coo|ceo|founder|owner|principal|lead)\s+(?:of|for|engineer|developer|architect)/i,
  /(?:title|role|position)\s*:\s*(?:vp|director|head|chief|senior)/i,
  /\b(vp|director|head\s+of)\b/i,
]

interface SignalQualityScore {
  specificity: number
  recencyBoost: number
  authority: number
  composite: number
}

function scoreSignalQuality(signal: Signal): SignalQualityScore {
  const text = signal.raw_text

  const specificity = Math.min(SPECIFICITY_INDICATORS.reduce((s, p) => p.test(text) ? s + 0.2 : s, 0), 1.0)
  const recencyBoost = Math.min(RECENCY_INDICATORS.reduce((s, p) => p.test(text) ? s + 0.15 : s, 0), 1.0)
  const authority = Math.min(AUTHORITY_INDICATORS.reduce((s, p) => p.test(text) ? s + 0.25 : s, 0), 1.0)

  const composite = (specificity * 0.4) + (recencyBoost * 0.3) + (authority * 0.3)

  return { specificity, recencyBoost, authority, composite }
}

/* =========================================================
   5. REVENUE INDICATORS
   ========================================================= */

const REVENUE_INDICATORS = [
  /\$\d+[kbm]?\s+(?:annual|monthly|yearly|quarterly)\s+(?:revenue|income|sales|turnover|billings)/i,
  /(?:annual|monthly|yearly|quarterly)\s+(?:revenue|income|sales|turnover|billings)\s+(?:of|:)?\s*\$?\d+[kbm]?/i,
  /(?:revenue|sales|turnover|billings)\s+(?:grew|increased|rose|climbed).*?\$?\d+[kbm]/i,
  /\$\d+[kbm]?\s+(?:ARPU|ARR|MRR|LTV|CAC|GMV)/i,
  /ARR\s+(?:of|:)?\s*\$?\d+[kbm]?/i,
  /MRR\s+(?:of|:)?\s*\$?\d+[kbm]?/i,
  /(?:funding|revenue|valuation).*?\$?\d+[kbm]/i,
  /\$\d+[kbm].*?(?:run\s+rate|annualized)/i,
]

const CONTACT_INFO_PATTERNS = [
  // Phone numbers
  /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/,
  // Email addresses
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  // Physical address patterns
  /\d{1,5}\s+[A-Za-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Plaza|Square|Sq)\b/i,
  /\b(?:P\.?O\.?\s+Box|Post\s+Office\s+Box)\s+\d+/i,
  // Suite/Unit patterns
  /\b(?:Suite|Ste|Unit|Floor|Fl|Office)\s+#?\d+/i,
]

function checkRevenueIndicators(text: string): "likely" | "unlikely" | "unknown" {
  const matchCount = REVENUE_INDICATORS.reduce((s, p) => p.test(text) ? s + 1 : s, 0)
  if (matchCount >= 2) return "likely"
  if (matchCount >= 1) return "unlikely"
  return "unknown"
}

function checkContactInfoPresence(text: string): boolean {
  return CONTACT_INFO_PATTERNS.some(p => p.test(text))
}

/* =========================================================
   MAIN PRE-VALIDATION PIPELINE
   ========================================================= */

export function runPreValidation(
  companyName: string,
  domain: string | undefined,
  signal: Signal
): PreValidationResult {
  const rejectionReasons: string[] = []

  const providerCheck = checkServiceProvider(domain, signal)
  if (providerCheck.risk === "high") {
    rejectionReasons.push(...providerCheck.reasons.map(r => `Provider: ${r}`))
  }

  const geoCheck = checkGeographic(domain, signal)
  if (!geoCheck.match && (domain || signal.raw_text)) {
    rejectionReasons.push(`No geographic match to target regions`)
  }

  const firmoCheck = estimateFirmographics(domain, signal)
  if (firmoCheck.fit === "poor") {
    rejectionReasons.push(...firmoCheck.reasons.map(r => `Firmographic: ${r}`))
  }

  const signalQuality = scoreSignalQuality(signal)

  const revenueIndication = checkRevenueIndicators(signal.raw_text)
  const contactInfoPresent = checkContactInfoPresence(signal.raw_text)

  const passed = rejectionReasons.length === 0

  return {
    passed,
    serviceProviderRisk: providerCheck.risk,
    geographicMatch: geoCheck.match || (!domain && !signal.raw_text),
    firmographicFit: firmoCheck.fit,
    signalQuality: signalQuality.composite,
    revenueIndication,
    contactInfoPresent,
    rejectionReasons,
  }
}
