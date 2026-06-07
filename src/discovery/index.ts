import pino from "pino"
import { supabase, getRunnableBrands, type BrandProfile } from "../db/supabase"
import { getExecutor, type ExecutorParams } from "./registry"
import type { DiscoveryResult } from "./types"
import { extractSignal, type Signal } from "./core/signal-extractor"
import { matchOpportunity, type OpportunityScore, type BrandContext } from "./core/opportunity-matcher"
import { normalizeOpportunity, type NormalizedOpportunity } from "./core/normalizer"
import { discoverDecisionMakers, storeDiscoveredContacts } from "./contacts"
import { isGenericEmail } from "../enrichment/utils/email-validator"
import { isJobBoardOrRecruiter } from "./core/job-board-filter"
import { isEnterpriseDomain, isMediaDomain } from "./core/enterprise-filter"
import { domainResolver } from "./utils/domain-resolver"

// Re-export signal-driven discovery for main entry point
export { startSignalDiscovery } from "./signals/engine"

// Legacy discovery wrapper — delegates to signal-driven discovery
export async function startDiscovery(brandId?: string, maxSources?: number): Promise<NormalizedOpportunity[]> {
  const { startSignalDiscovery } = await import("./signals/engine")
  return startSignalDiscovery(brandId, maxSources || 20)
}

export async function testDiscovery(): Promise<void> {
  const logger = pino({ level: "info" })
  logger.info("Legacy testDiscovery called — no-op (use startSignalDiscovery instead)")
}

const logger = pino({ level: "info" })

let shuttingDown = false
let totalStored = 0

/* =========================================================
   BUILD BRAND CONTEXT FROM DB FIELDS
========================================================= */

function buildBrandContext(brand: BrandProfile): BrandContext {
  const textFields = [brand.product, brand.core_offer, brand.positioning, brand.audience]
    .filter(Boolean)
    .join(" ");

  // Extract meaningful keywords (2+ chars, exclude generic stop words)
  const stopWords = new Set([
    "the", "and", "for", "with", "this", "that", "are", "you", "our", "we", "to",
    "in", "on", "at", "by", "is", "it", "of", "or", "be", "an", "as", "will",
    "do", "not", "but", "if", "from", "has", "have", "had", "what", "when",
    "where", "who", "which", "how", "all", "any", "can", "etc", "get", "your"
  ]);

  const keywords = [...new Set(
    textFields
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  )];

  return {
    name: brand.brand_name || brand.product || "brand",
    industry: brand.product || undefined,
    keywords,
  }
}

/* =========================================================
   PRE-VALIDATION FUNCTIONS (Phase 3 of Improvement Plan)
========================================================= */

/**
 * Check if a company is likely a service provider (not our target client)
 * Returns true if we should skip this company
 */
async function isLikelyServiceProvider(
  companyName: string,
  domain: string | undefined,
  signal: Signal
): Promise<boolean> {
  // 1. Domain-based checks
  if (domain) {
    const providerTlds = [".agency", ".studio", ".dev", ".services", ".solutions", ".consulting"];
    if (providerTlds.some(tld => domain.endsWith(tld))) {
      logger.debug({ company: companyName, domain }, "Service provider TLD detected");
      return true;
    }
  }

  // 2. Content-based provider language detection (stronger than signal intent)
  const providerContentIndicators = [
    "we offer", "we provide", "we build", "we create", "we develop",
    "our services", "our solutions", "our products", "we specialize in",
    "we help companies", "we work with clients", "our team of experts",
    "years of experience", "proven track record", "trusted by",
    "award winning", "leading provider", "top rated", "best in class",
    "contact us", "get a quote", "schedule a consultation"
  ];

  const providerContentScore = providerContentIndicators.reduce((score, indicator) => {
    return signal.raw_text.toLowerCase().includes(indicator) ? score + 1 : score;
  }, 0);

  if (providerContentScore >= 2) {
    logger.debug({ 
      company: companyName, 
      providerScore: providerContentScore,
      reason: "Strong provider language detected"
    }, "Service provider content detected");
    return true;
  }

  // 3. Check if signal itself indicates strong provider intent
  // (We already have intent detection in signal extractor, but let's reinforce)
  if (signal.intent === 'provider' && signal.confidence_score > 0.6) {
    logger.debug({ 
      company: companyName, 
      intent: signal.intent,
      confidence: signal.confidence_score,
      reason: "High confidence provider intent from signal"
    }, "Service provider signal detected");
    return true;
  }

  return false;
}

/**
 * Validate geographic fit for our target regions
 */
async function validateGeographicFit(
  companyName: string,
  domain: string | undefined,
  signal: Signal
): Promise<boolean> {
  // If we have no domain or location hints, we can't validate
  if (!domain && !signal.raw_text) return true; // Don't reject if we have no info
  
  const textToCheck = `${companyName} ${signal.raw_text || ""} ${domain || ""}`.toLowerCase();
  
  // Target regions: Dubai/UAE, Europe, US
  const targetRegions = [
    // Middle East
    "dubai", "uae", "united arab emirates", "abu dhabi", "sharjah", 
    // Europe
    "europe", "eu", "uk", "united kingdom", "england", "scotland", "wales", "northern ireland",
    "germany", "france", "netherlands", "spain", "italy", "sweden", "norway", "denmark",
    "finland", "belgium", "austria", "switzerland", "poland", "czech", "ireland",
    // US
    "united states", "usa", "us ", "america", "new york", "california", "texas", "florida",
    "illinois", "pennsylvania", "ohio", "georgia", "north carolina", "michigan"
  ];

  // Also check for common TLDs of target regions
  const targetTlds = [".ae", ".uk", ".de", ".fr", ".nl", ".es", ".it", ".se", ".no", ".dk", 
                     ".fi", ".be", ".at", ".ch", ".pl", ".cz", ".ie", ".us", ".nyc", ".ca"];

  // Check if text mentions target regions
  const regionMatch = targetRegions.some(region => textToCheck.includes(region));
  if (regionMatch) return true;

  // Check domain TLD
  if (domain) {
    const tldMatch = targetTlds.some(tld => domain.endsWith(tld));
    if (tldMatch) return true;
  }

  // If we have some location info but no match, reject
  const hasLocationInfo = 
    /\b(dubai|uae|emirates|europe|eu|uk|england|[a-z]+)\s+(kingdom|states|states|america)\b/i.test(textToCheck) ||
    /\.[a-z]{2,3}$/.test(domain || ""); // Has a TLD-like pattern
    
  if (hasLocationInfo && !regionMatch && !(domain && targetTlds.some(tld => domain.endsWith(tld)))) {
    logger.debug({ 
      company: companyName, 
      domain, 
      text: signal.raw_text?.substring(0, 100),
      reason: "Location info present but not in target regions"
    }, "Geographic mismatch");
    return false;
  }

  // No location info to contradict - assume OK
  return true;
}

/**
 * Estimate firmographic basics (size, industry) from available signals
 */
async function estimateFirmographicFit(
  companyName: string,
  domain: string | undefined,
  signal: Signal
): Promise<boolean> {
  const text = `${companyName} ${signal.raw_text || ""} ${domain || ""}`.toLowerCase();
  
  // Target: B2B companies (5-100 employees) needing product engineering
  // Avoid: Pure tech/software companies, B2C, enterprises (>1000), very small (<5)
  
  // Enterprise/reduction indicators
  const enterpriseIndicators = [
    "fortune 500", "global leader", "multinational", "enterprise", "corporation",
    "incorporated", "inc.", "ltd", "limited", "plc", "group holdings",
    "headquarters", "hq", "subsidiary", "parent company"
  ];
  
  const enterpriseScore = enterpriseIndicators.reduce((score, indicator) => {
    return text.includes(indicator) ? score + 1 : score;
  }, 0);
  
  // Strong enterprise indicators suggest too big
  if (enterpriseScore >= 2) {
    logger.debug({ 
      company: companyName, 
      enterpriseScore,
      reason: "Likely enterprise (>1000 employees)"
    }, "Firmographic - too large");
    return false;
  }
  
  // Very small business / solopreneur indicators
  const tinyBusinessIndicators = [
    "freelancer", "solopreneur", "independent contractor", "self-employed",
    "one person", "sole proprietor", "dad blog", "mom blog", "side hustle"
  ];
  
  const tinyScore = tinyBusinessIndicators.reduce((score, indicator) => {
    return text.includes(indicator) ? score + 1 : score;
  }, 0);
  
  if (tinyScore >= 1) {
    logger.debug({ 
      company: companyName, 
      tinyScore,
      reason: "Likely very small business/solopreneur"
    }, "Firmographic - too small");
    return false;
  }
  
  // Employee count hints from text
  const sizePatterns = [
    /(?:we\s+are\s+|our\s+team\s+of\s+)(\d+)\s*(?:people|person|employees?|staff)/,
    /(?:team\s+of\s+|staff\s+of\s+)(\d+)/,
    /(\d+)\s*(?:people|person|employees?|staff)\s+(?:team|strong)/,
    /(?:grown\s+to\s+|expanded\s+to\s+|now\s+at\s+)(\d+)\s*(?:people|person|employees?)/
  ];
  
  let estimatedSize = null;
  for (const pattern of sizePatterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (!isNaN(num)) {
        estimatedSize = num;
        break;
      }
    }
  }
  
  // If we have a size estimate, check if it's in our target range (5-100)
  if (estimatedSize !== null) {
    if (estimatedSize < 5) {
      logger.debug({ 
        company: companyName, 
        estimatedSize,
        reason: "Estimated size too small (<5)"
      }, "Firmographic - too small");
      return false;
    }
    if (estimatedSize > 100) {
      logger.debug({ 
        company: companyName, 
        estimatedSize,
        reason: "Estimated size too large (>100)"
      }, "Firmographic - too large");
      return false;
    }
    logger.debug({ 
      company: companyName, 
      estimatedSize,
      reason: "Estimated size in target range (5-100)"
    }, "Firmographic - size OK");
  }
  
  // Industry checks - avoid pure tech/software product companies unless they're end-users
  // We want B2B companies that USE tech, not necessarily SELL tech as their primary product
  const pureTechIndicators = [
    "software company", "saas company", "tech startup", "app developer",
    "game developer", "software product", "tech product", "software vendor",
    "it company", "information technology", "software house"
  ];
  
  const pureTechScore = pureTechIndicators.reduce((score, indicator) => {
    return text.includes(indicator) ? score + 1 : score;
  }, 0);
  
  // Tech/SaaS companies are clients for product engineering services - don't reject
  if (pureTechScore >= 2) {
    logger.debug({ 
      company: companyName, 
      pureTechScore,
      reason: "Pure tech/product company — OK for product engineering services"
    }, "Firmographic - pure tech OK");
  }
  
  // Positive B2B/service industry indicators
  const b2bIndicators = [
    "b2b", "business to business", "enterprise client", "corporate client",
    "professional services", "consulting", "manufacturing", "healthcare",
    "finance", "banking", "insurance", "retail", "ecommerce", "logistics",
    "supply chain", "real estate", "education", "nonprofit", "government",
    "municipal", "federal", "state government", "local government"
  ];
  
  const b2bScore = b2bIndicators.reduce((score, indicator) => {
    return text.includes(indicator) ? score + 1 : score;
  }, 0);
  
  // If we see strong B2B indicators, that's good
  if (b2bScore >= 1) {
    logger.debug({ 
      company: companyName, 
      b2bScore,
      reason: "Strong B2B industry indicators"
    }, "Firmographic - B2B OK");
  }
  
  // No firmographic red flags found
  return true;
}

/* =========================================================
   STORE OPPORTUNITY IN DB
========================================================= */

async function storeOpportunityInDB(opp: NormalizedOpportunity, brandId: string): Promise<{ stored: boolean; companyId?: string }> {
  try {
    const domain = opp.domain || (() => {
      try { return new URL(opp.url).hostname || "unknown.com" }
      catch { return "unknown.com" }
    })()

    const { data, error } = await supabase
      .from("discovered_companies")
      .upsert({
        brand_id: brandId,
        domain,
        name: (opp.company || opp.title || "Unknown").substring(0, 255),
        website: opp.url?.substring(0, 500) || null,
        signal_type: opp.signal_type,
        relevance_score: opp.relevance_score,
        urgency_score: opp.urgency_score,
        fit_reason: opp.fit_reason?.substring(0, 500) || null,
        summary: opp.summary?.substring(0, 1000) || null,
        source_name: opp.source,
        requires_enrichment: true,
        raw_payload: {
          title: opp.title,
          url: opp.url,
          signal_type: opp.signal_type,
          relevance_score: opp.relevance_score,
          job_title: opp.job_title || null,
        },
        discovered_at: new Date(opp.timestamp || Date.now()).toISOString()
      }, { onConflict: "brand_id,domain" })
      .select("id")
      .single()

    if (error) {
      logger.error({ error: error.message, url: opp.url }, "Failed to store opportunity")
      return { stored: false }
    }

    logger.info({ source: opp.source, signal: opp.signal_type, url: opp.url }, "Stored opportunity in DB")
    return { stored: true, companyId: data?.id }
  } catch (err: any) {
    logger.error({ error: err.message }, "DB storage error")
    return { stored: false }
  }
}