import {
  EnrichmentStrategyExecutor,
  EnrichmentStatus,
  EnrichmentStrategyType,
  EnrichmentContext,
  ClaimedContact,
  ClaimedCompany
} from "../types"

import { supabase } from "../../db/supabase"

export const companyResearchExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext) {

    const { type, entity } = context

    /* ---------------- CONTACT MODE ---------------- */

    if (type === "contact") {
      const contact = entity as ClaimedContact

      if (!contact.domain) {
        return { status: EnrichmentStatus.FAILED }
      }

      const { data, error } = await supabase.rpc(
        "research_company_profile",
        { p_domain: contact.domain }
      )

      if (error || !data) {
        return {
          status: EnrichmentStatus.FAILED,
          error: error?.message ?? "RPC failure"
        }
      }

      return {
        status: EnrichmentStatus.PARTIAL,
        data: {
          title: data.suggested_title ?? contact.title ?? undefined,
          intent_score: data.intent_score ?? 0,
          confidence: 0.7,
          strategy: EnrichmentStrategyType.COMPANY_RESEARCH,
          raw: data
        }
      }
    }

    /* ---------------- COMPANY MODE ---------------- */

    if (type === "company") {
      const company = entity as ClaimedCompany

      if (!company.domain) {
        return { status: EnrichmentStatus.FAILED }
      }

      const { data, error } = await supabase.rpc(
        "research_company_profile",
        { p_domain: company.domain }
      )

      if (error || !data) {
        return {
          status: EnrichmentStatus.FAILED,
          error: error?.message ?? "RPC failure"
        }
      }

      return {
        status: EnrichmentStatus.PARTIAL,
        data: {
          company_name: data.company_name ?? company.name ?? undefined,
          website: data.website ?? company.website ?? undefined,
          intent_score: data.intent_score ?? 0,
          confidence: 0.65,
          strategy: EnrichmentStrategyType.COMPANY_RESEARCH,
          raw: data
        }
      }
    }

    return { status: EnrichmentStatus.FAILED }
  }
}