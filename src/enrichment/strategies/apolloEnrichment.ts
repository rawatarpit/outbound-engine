import axios from "axios"
import pino from "pino"
import {
  EnrichmentStrategyExecutor,
  EnrichmentStatus,
  EnrichmentStrategyType,
  EnrichmentContext,
  ClaimedCompany,
} from "../types"
import { supabase } from "../../db/supabase"
import { isValidPersonalEmail } from "../utils/email-validator"

const logger = pino({ level: "info" })

const APOLLO_API_URL = "https://api.apollo.io/api/v1/people/search"
const TARGET_ROLES = ["CEO", "Founder", "CTO", "VP of Sales", "Head of Engineering", "Head of Product"]

async function getApolloKey(brandId: string): Promise<string | null> {
  const { data: brand } = await supabase
    .from("brand_profiles")
    .select("client_id")
    .eq("id", brandId)
    .single()

  if (!brand?.client_id) return null

  const { data: settings } = await supabase
    .from("client_settings")
    .select("config")
    .eq("client_id", brand.client_id)
    .maybeSingle()

  const config = settings?.config as Record<string, unknown> | null
  return (config?.apollo_api_key as string) || null
}

export const apolloEnrichmentExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext): Promise<any> {
    const { type, entity } = context

    if (type !== "company") {
      return { status: EnrichmentStatus.FAILED, error: "Apollo enrichment only works on companies" }
    }

    const company = entity as ClaimedCompany

    if (!company.domain || !company.brand_id) {
      return { status: EnrichmentStatus.FAILED, error: "Company missing domain or brand_id" }
    }

    const apiKey = await getApolloKey(company.brand_id)
    if (!apiKey) {
      logger.info({ brandId: company.brand_id }, "No Apollo API key configured — skipping")
      return { status: EnrichmentStatus.FAILED, error: "No Apollo API key" }
    }

    try {
      const response = await axios.post(
        APOLLO_API_URL,
        {
          organization_domains: [company.domain],
          person_titles: TARGET_ROLES,
          page: 1,
          per_page: 5,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": apiKey,
          },
          timeout: 15000,
        },
      )

      const people = response.data?.people || []
      if (!people.length) {
        logger.info({ domain: company.domain }, "Apollo returned no contacts")
        return { status: EnrichmentStatus.PARTIAL, data: { confidence: 0, strategy: EnrichmentStrategyType.API_CONTACT_ENRICHMENT } }
      }

      const valid = people.filter((p: any) => p.email && isValidPersonalEmail(p.email))
      if (!valid.length) {
        logger.info({ domain: company.domain }, "Apollo returned contacts but no valid emails")
        return { status: EnrichmentStatus.PARTIAL, data: { confidence: 0.3, strategy: EnrichmentStrategyType.API_CONTACT_ENRICHMENT } }
      }

      const primary = valid[0]
      const contact = {
        first_name: primary.first_name || primary.name?.split(" ")[0] || "",
        last_name: primary.last_name || primary.name?.split(" ").slice(1).join(" ") || "Unknown",
        full_name: primary.name || `${primary.first_name} ${primary.last_name}`.trim(),
        email: primary.email.toLowerCase(),
        title: primary.title || "Decision Maker",
        linkedin_url: primary.linkedin_url || undefined,
        confidence: 0.85,
      }

      logger.info({ domain: company.domain, name: contact.full_name, email: contact.email }, "Apollo enrichment found contact")

      return {
        status: EnrichmentStatus.SUCCESS,
        data: {
          first_name: contact.first_name,
          last_name: contact.last_name,
          full_name: contact.full_name,
          email: contact.email,
          title: contact.title,
          linkedin_url: contact.linkedin_url,
          email_verified: true,
          confidence: contact.confidence,
          strategy: EnrichmentStrategyType.API_CONTACT_ENRICHMENT,
          raw: { apollo_people_found: people.length, primary },
        },
      }
    } catch (err: any) {
      logger.error({ domain: company.domain, error: err.message }, "Apollo API call failed")
      return { status: EnrichmentStatus.FAILED, error: `Apollo API error: ${err.message}` }
    }
  },
}
