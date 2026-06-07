import {
  EnrichmentStrategyExecutor,
  EnrichmentContext,
  EnrichmentResult,
  EnrichmentStatus,
  EnrichmentStrategyType,
  ClaimedCompany,
  EnrichedData,
} from "../types"
import { discoverDecisionMakers } from "../../discovery/contacts/finder"
import { storeDiscoveredContacts } from "../../discovery/contacts/storage"
import { isGenericEmail, isValidPersonalEmail } from "../utils/email-validator"
import { isEnterpriseDomain, isEnterpriseDescription, isMediaDomain } from "../../discovery/core/enterprise-filter"
import pino from "pino"

const logger = pino({ level: "info" })

export const contactDiscoveryExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext): Promise<EnrichmentResult> {
    const { type, entity, targetConfidence } = context

    if (type !== "company") {
      return { status: EnrichmentStatus.FAILED, error: "Contact discovery only works on companies" }
    }

    const company = entity as ClaimedCompany

    if (!company.domain || !company.name) {
      return { status: EnrichmentStatus.FAILED, error: "Company missing domain or name" }
    }

    if (isEnterpriseDomain(company.domain)) {
      return { status: EnrichmentStatus.FAILED, error: "Enterprise domain skipped" }
    }

    if (isMediaDomain(company.domain)) {
      return { status: EnrichmentStatus.FAILED, error: "Media/social domain skipped" }
    }

    const rawPayload = company.raw_payload as any
    const description = rawPayload?.description || ""
    const companySize = rawPayload?.company_size || ""
    if (companySize === "enterprise" || isEnterpriseDescription(description)) {
      return { status: EnrichmentStatus.FAILED, error: "Enterprise company skipped" }
    }

    try {
      const raw = company.raw_payload as any
      const result = await discoverDecisionMakers({
        companyName: company.name,
        domain: company.domain,
        industry: raw?.industry,
        brandContext: raw?.brand_context,
        targetRoles: raw?.target_roles,
        clientId: raw?.client_id,
        linkedinUrl: raw?.linkedin_url,
      })

      if (result.contacts.length === 0) {
        return {
          status: EnrichmentStatus.PARTIAL,
          data: {
            confidence: 0.2,
            strategy: EnrichmentStrategyType.CONTACT_DISCOVERY,
          },
        }
      }

      const storedCount = await storeDiscoveredContacts({
        brandId: company.brand_id,
        discoveredCompanyId: company.id,
        contacts: result.contacts,
        domain: company.domain,
      })

      const primaryContact = result.contacts[0]
      const hasValidEmail = primaryContact.email && isValidPersonalEmail(primaryContact.email)

      const contactData: EnrichedData = {
        confidence: Math.min(primaryContact.confidence, 0.85),
        strategy: EnrichmentStrategyType.CONTACT_DISCOVERY,
        first_name: primaryContact.first_name,
        last_name: primaryContact.last_name,
        full_name: primaryContact.full_name,
        title: primaryContact.title,
        email: hasValidEmail ? primaryContact.email : undefined,
        linkedin_url: primaryContact.linkedin_url,
        intent_score: primaryContact.confidence,
        raw: {
          contacts_found: result.contacts.length,
          contacts_stored: storedCount,
          primary_contact: primaryContact,
          source: result.source,
        },
      }

      if (hasValidEmail && primaryContact.confidence >= targetConfidence) {
        return {
          status: EnrichmentStatus.SUCCESS,
          data: contactData,
        }
      }

      return {
        status: EnrichmentStatus.PARTIAL,
        data: contactData,
      }
    } catch (err: any) {
      logger.error(
        { company: company.name, error: err.message },
        "Contact discovery strategy failed"
      )
      return {
        status: EnrichmentStatus.FAILED,
        error: err.message,
      }
    }
  },
}
