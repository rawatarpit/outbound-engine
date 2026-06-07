import pino from "pino"
import {
  supabase,
  getBrandProfile,
  type Opportunity,
  getActiveOpportunities,
  ingestLead,
} from "../db/supabase"
import { enforceSafety } from "./safety"
import { buildEnrichmentPlan } from "./strategyRouter"
import { getStrategyExecutor } from "./strategies/registry"
import { validateEnrichedData } from "./utils/validators"
import { computeConfidence } from "./scoring"
import { persistEnrichmentResult } from "./update"
import type { EnrichmentStrategyType } from "./types"
import { EnrichmentStatus } from "./types"

const logger = pino({ level: "info" })

const CONFIG = {
  batchSize: 20,
  minScore: 40,
  targetConfidence: 0.75,
  maxAttempts: 3,
}

export interface EnrichedOpportunity {
  company: string
  domain: string
  contacts: OpportunityContact[]
  signal: string
  signal_type?: string
  score: number
}

export interface OpportunityContact {
  name: string
  role?: string
  email?: string
  linkedin?: string
  confidence?: number
}

export async function processOpportunitiesForEnrichment(
  brandId: string,
  minScore: number = CONFIG.minScore
): Promise<{ processed: number; enriched: number; ingested: number }> {
  const brand = await getBrandProfile(brandId)
  if (!brand || brand.is_paused) {
    return { processed: 0, enriched: 0, ingested: 0 }
  }

  const opportunities = await getActiveOpportunities(brandId, CONFIG.batchSize)

  const eligible = opportunities.filter(
    (o) => o.score >= minScore && o.domain && !o.ingested
  )

  logger.info(
    { brandId, eligible: eligible.length, minScore },
    "Processing opportunities for enrichment"
  )

  let enriched = 0
  let ingested = 0

  for (const opp of eligible) {
    try {
      const enrichedData = await enrichOpportunity(opp)

      if (enrichedData?.contacts && enrichedData.contacts.length > 0) {
        await markEnriched(opp.id)
        enriched++

        for (const contact of enrichedData.contacts) {
          if (contact.email) {
            await ingestLead({
              brand_id: brandId,
              first_name: contact.name.split(" ")[0],
              last_name: contact.name.split(" ").slice(1).join(" "),
              email: contact.email,
              title: contact.role,
              company_name: opp.name,
              domain: opp.domain ?? undefined,
              linkedin_url: contact.linkedin,
              source: opp.source,
              source_id: opp.id,
              raw_payload: { signal: opp.signal, score: opp.score },
            })
            ingested++
          }
        }
      } else {
        await markQualified(opp.id)
      }
    } catch (error) {
      logger.error(
        { opportunityId: opp.id, error: error instanceof Error ? error.message : "Unknown" },
        "Opportunity enrichment failed"
      )
    }
  }

  return { processed: eligible.length, enriched, ingested }
}

async function enrichOpportunity(
  opp: Opportunity
): Promise<EnrichedOpportunity | null> {
  if (!opp.domain) return null

  const mockContact: OpportunityContact = {
    name: opp.name,
    role: inferRoleFromSignal(opp.signal),
    confidence: opp.confidence / 100,
  }

  return {
    company: opp.name,
    domain: opp.domain,
    contacts: [mockContact],
    signal: opp.signal,
    score: opp.score,
  }
}

function inferRoleFromSignal(signal: string): string {
  const roleMap: Record<string, string> = {
    hiring: "Hiring Manager",
    funding: "Founder",
    launch: "Product Manager",
    pain: "Decision Maker",
    advertising: "Marketing Head",
    partnership: "Business Development",
    tech_usage: "Tech Lead",
    growth_activity: "Sales Lead",
  }
  return roleMap[signal] ?? "Decision Maker"
}

async function markEnriched(oppId: string): Promise<void> {
  await supabase
    .from("opportunities")
    .update({
      qualification_status: "qualified",
      ingested: true,
    })
    .eq("id", oppId)
}

async function markQualified(oppId: string): Promise<void> {
  await supabase
    .from("opportunities")
    .update({
      qualification_status: "qualified",
    })
    .eq("id", oppId)
}

export async function getEnrichedLeadData(
  brandId: string,
  limit: number = 10
): Promise<EnrichedOpportunity[]> {
  const opportunities = await getActiveOpportunities(brandId, limit)

  return opportunities
    .filter((o) => o.qualification_status === "qualified" && o.ingested)
    .map(
      (o): EnrichedOpportunity => ({
        company: o.name,
        domain: o.domain ?? "",
        contacts: [],
        signal: o.signal,
        score: o.score,
      })
    )
}