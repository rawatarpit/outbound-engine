import pino from "pino"
import { supabase } from "../../db/supabase"
import type { DiscoveredContact } from "./finder"

const logger = pino({ level: "info" })

export async function storeDiscoveredContact(params: {
  brandId: string
  discoveredCompanyId: string
  contact: DiscoveredContact
  domain: string
}): Promise<boolean> {
  const { brandId, discoveredCompanyId, contact, domain } = params

  try {
    const { error } = await supabase
      .from("discovered_contacts")
      .insert({
        brand_id: brandId,
        discovered_company_id: discoveredCompanyId,
        first_name: contact.first_name.substring(0, 100),
        last_name: contact.last_name.substring(0, 100),
        full_name: contact.full_name.substring(0, 200),
        email: contact.email?.toLowerCase() || null,
        domain: domain.toLowerCase(),
        title: contact.title.substring(0, 200),
        linkedin_url: contact.linkedin_url || null,
        confidence: contact.confidence,
        requires_enrichment: !contact.email,
        enrichment_status: contact.email ? "pending" : "pending",
        raw_payload: {
          source: "llm_contact_discovery",
          reasoning: contact.reasoning,
        },
      })

    if (error) {
      if (error.code === "23505") {
        logger.debug(
          { email: contact.email, company: discoveredCompanyId },
          "Contact already exists"
        )
        return false
      }
      logger.error(
        { error: error.message, contact: contact.full_name },
        "Failed to store discovered contact"
      )
      return false
    }

    logger.info(
      { name: contact.full_name, email: contact.email, company: discoveredCompanyId },
      "Stored discovered contact"
    )

    return true
  } catch (err: any) {
    logger.error(
      { error: err.message, contact: contact.full_name },
      "Error storing discovered contact"
    )
    return false
  }
}

export async function storeDiscoveredContacts(params: {
  brandId: string
  discoveredCompanyId: string
  contacts: DiscoveredContact[]
  domain: string
}): Promise<number> {
  const { brandId, discoveredCompanyId, contacts, domain } = params

  let stored = 0

  for (const contact of contacts) {
    const success = await storeDiscoveredContact({
      brandId,
      discoveredCompanyId,
      contact,
      domain,
    })
    if (success) stored++
  }

  return stored
}

export async function getCompanyIdByDomainAndBrand(
  domain: string,
  brandId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("discovered_companies")
      .select("id")
      .eq("domain", domain.toLowerCase())
      .eq("brand_id", brandId)
      .single()

    if (error || !data) {
      return null
    }

    return data.id as string
  } catch {
    return null
  }
}
