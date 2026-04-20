import {
  EnrichmentStrategyExecutor,
  EnrichmentStatus,
  EnrichmentStrategyType,
  EnrichmentContext,
  ClaimedContact,
  ClaimedCompany,
} from "../types";

import { supabase } from "../../db/supabase";
import { normalizeEmail } from "../../discovery/normalizer";

export const apiEnrichmentExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext) {
    const { type, entity } = context;

    /* =====================================================
       CONTACT ENRICHMENT
    ====================================================== */

    if (type === "contact") {
      const contact = entity as ClaimedContact;

      if (!contact.domain) {
        return { status: EnrichmentStatus.FAILED };
      }

      const { data: quotaAllowed, error: quotaError } = await supabase.rpc(
        "rpc_consume_api_quota",
        {
          p_brand_id: contact.brand_id,
        },
      );

      if (quotaError || !quotaAllowed) {
        return {
          status: EnrichmentStatus.FAILED,
          error: "API quota exhausted",
        };
      }

      const { data, error } = await supabase.rpc("enrich_contact_via_api", {
        p_domain: contact.domain,
        p_first_name: contact.first_name,
        p_last_name: contact.last_name,
      });

      if (error || !data) {
        return {
          status: EnrichmentStatus.FAILED,
          error: error?.message ?? "API enrichment failed",
        };
      }

      let normalizedEmail: string | undefined;

      if (data.email) {
        const cleaned = normalizeEmail(data.email);
        if (typeof cleaned === "string") {
          normalizedEmail = cleaned;
        }
      }

      return {
        status: EnrichmentStatus.SUCCESS,
        data: {
          email: normalizedEmail,
          email_verified: true,
          title: data.title ?? undefined,
          linkedin_url: data.linkedin_url ?? undefined,
          confidence: 0.85,
          intent_score: data.intent_score ?? 0,
          strategy: EnrichmentStrategyType.API_ENRICHMENT,
          raw: data,
        },
      };
    }

    /* =====================================================
       COMPANY ENRICHMENT
    ====================================================== */

    if (type === "company") {
      const company = entity as ClaimedCompany;

      if (!company.domain) {
        return { status: EnrichmentStatus.FAILED };
      }

      const { data, error } = await supabase.rpc("research_company_profile", {
        p_domain: company.domain,
      });

      if (error || !data) {
        return {
          status: EnrichmentStatus.FAILED,
          error: error?.message ?? "Company API enrichment failed",
        };
      }

      return {
        status: EnrichmentStatus.PARTIAL,
        data: {
          company_name: data.company_name ?? company.name ?? undefined,
          website: data.website ?? company.website ?? undefined,
          domain: company.domain,
          confidence: 0.7,
          intent_score: data.intent_score ?? 0,
          strategy: EnrichmentStrategyType.API_ENRICHMENT,
          raw: data,
        },
      };
    }

    return { status: EnrichmentStatus.FAILED };
  },
};
