import axios from "axios"
import pino from "pino"
import {
  EnrichmentStrategyExecutor,
  EnrichmentStatus,
  EnrichmentStrategyType,
  EnrichmentContext,
  ClaimedContact,
  ClaimedCompany,
} from "../types"
import { supabase } from "../../db/supabase"
import { normalizeEmail } from "../../discovery/normalizer"

const logger = pino({ level: "info" })

function mapConfidence(hunterScore: number): number {
  if (hunterScore >= 95) return 0.90
  if (hunterScore >= 80) return 0.75
  if (hunterScore >= 50) return 0.50
  return 0.25
}

async function getHunterKey(brandId: string): Promise<string | null> {
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
  return (config?.hunter_api_key as string) || null
}

export const hunterEnrichmentExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext) {
    const { type, entity } = context

    const company = entity as ClaimedCompany | ClaimedContact
    const brandId = company.brand_id

    if (!brandId) {
      return { status: EnrichmentStatus.FAILED, error: "Missing brand_id" }
    }

    const apiKey = await getHunterKey(brandId)
    if (!apiKey) {
      logger.info({ brandId }, "No Hunter.io API key configured — skipping")
      return { status: EnrichmentStatus.FAILED, error: "No Hunter.io API key" }
    }

    if (type === "contact") {
      const contact = entity as ClaimedContact
      if (!contact.domain) {
        return { status: EnrichmentStatus.FAILED }
      }

      try {
        const params: Record<string, string> = {
          domain: contact.domain,
          api_key: apiKey,
        }
        if (contact.first_name) params.first_name = contact.first_name
        if (contact.last_name) params.last_name = contact.last_name

        const response = await axios.get("https://api.hunter.io/v2/email-finder", {
          params,
          timeout: 15000,
        })

        const result = response.data?.data
        if (!result?.email) {
          return {
            status: EnrichmentStatus.PARTIAL,
            data: { confidence: 0, strategy: EnrichmentStrategyType.HUNTER_ENRICHMENT },
          }
        }

        const cleaned = normalizeEmail(result.email)
        const email = typeof cleaned === "string" ? cleaned : result.email
        const confidence = mapConfidence(result.score ?? 0)

        return {
          status: EnrichmentStatus.SUCCESS,
          data: {
            email,
            email_verified: true,
            title: result.position ?? undefined,
            linkedin_url: result.linkedin_url ?? undefined,
            confidence,
            intent_score: confidence,
            strategy: EnrichmentStrategyType.HUNTER_ENRICHMENT,
            raw: result,
          },
        }
      } catch (err: any) {
        logger.error({ domain: contact.domain, error: err.message }, "Hunter.io email-finder failed")
        return { status: EnrichmentStatus.FAILED, error: `Hunter.io error: ${err.message}` }
      }
    }

    if (type === "company") {
      const company = entity as ClaimedCompany
      if (!company.domain) {
        return { status: EnrichmentStatus.FAILED }
      }

      try {
        const response = await axios.get("https://api.hunter.io/v2/domain-search", {
          params: { domain: company.domain, api_key: apiKey },
          timeout: 15000,
        })

        const result = response.data?.data
        if (!result) {
          return {
            status: EnrichmentStatus.PARTIAL,
            data: { confidence: 0, strategy: EnrichmentStrategyType.HUNTER_ENRICHMENT },
          }
        }

        const org = result.organization ?? {}
        const emails = result.emails ?? []

        const topEmail = emails.length > 0 ? emails[0] : null
        const confidence = topEmail ? mapConfidence(topEmail.score ?? 0) : 0.3

        return {
          status: topEmail ? EnrichmentStatus.SUCCESS : EnrichmentStatus.PARTIAL,
          data: {
            company_name: org.name ?? company.name ?? undefined,
            website: org.website ?? company.website ?? undefined,
            domain: company.domain,
            email: topEmail?.value ?? undefined,
            first_name: topEmail?.first_name ?? undefined,
            last_name: topEmail?.last_name ?? undefined,
            title: topEmail?.position ?? undefined,
            confidence,
            intent_score: confidence,
            strategy: EnrichmentStrategyType.HUNTER_ENRICHMENT,
            raw: { organization: org, emails_found: emails.length },
          },
        }
      } catch (err: any) {
        logger.error({ domain: company.domain, error: err.message }, "Hunter.io domain-search failed")
        return { status: EnrichmentStatus.FAILED, error: `Hunter.io error: ${err.message}` }
      }
    }

    return { status: EnrichmentStatus.FAILED }
  },
}
