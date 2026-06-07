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

async function getProspeoKey(brandId: string): Promise<string | null> {
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
  return (config?.prospeo_api_key as string) || null
}

export const prospeoEnrichmentExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext) {
    const { type, entity } = context

    const company = entity as ClaimedCompany | ClaimedContact
    const brandId = company.brand_id

    if (!brandId) {
      return { status: EnrichmentStatus.FAILED, error: "Missing brand_id" }
    }

    const apiKey = await getProspeoKey(brandId)
    if (!apiKey) {
      logger.info({ brandId }, "No Prospeo API key configured — skipping")
      return { status: EnrichmentStatus.FAILED, error: "No Prospeo API key" }
    }

    if (type === "contact") {
      const contact = entity as ClaimedContact
      if (!contact.domain) {
        return { status: EnrichmentStatus.FAILED }
      }

      const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ")
      if (!name) {
        return { status: EnrichmentStatus.FAILED, error: "Contact name required for Prospeo" }
      }

      try {
        const response = await axios.post(
          "https://api.prospeo.io/email-find",
          { name, domain: contact.domain },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": apiKey,
            },
            timeout: 15000,
          },
        )

        const result = response.data
        if (!result?.email) {
          return {
            status: EnrichmentStatus.PARTIAL,
            data: { confidence: 0, strategy: EnrichmentStrategyType.PROSPEO_ENRICHMENT },
          }
        }

        const cleaned = normalizeEmail(result.email)
        const email = typeof cleaned === "string" ? cleaned : result.email

        return {
          status: EnrichmentStatus.SUCCESS,
          data: {
            email,
            email_verified: result.verified === true,
            title: result.position ?? contact.title ?? undefined,
            confidence: 0.65,
            intent_score: 0.5,
            strategy: EnrichmentStrategyType.PROSPEO_ENRICHMENT,
            raw: result,
          },
        }
      } catch (err: any) {
        logger.error({ domain: contact.domain, error: err.message }, "Prospeo email-find failed")
        return { status: EnrichmentStatus.FAILED, error: `Prospeo error: ${err.message}` }
      }
    }

    return { status: EnrichmentStatus.FAILED, error: "Prospeo enrichment only supports contacts" }
  },
}
