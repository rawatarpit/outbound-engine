import { supabase } from "../db/supabase";
import { FinalEnrichmentOutcome, EnrichmentStatus } from "./types";

export async function persistEnrichmentResult(outcome: FinalEnrichmentOutcome) {
  const { type, entityId, finalConfidence, enrichedData, status } = outcome;

  let error: any = null;

  /* ========================================================
     CONTACT PERSISTENCE
  ======================================================== */

  if (type === "contact") {
    const response = await supabase.rpc("update_contact_enrichment", {
      p_contact_id: entityId,
      p_confidence: finalConfidence,
      p_email: enrichedData?.email ?? null,
      p_title: enrichedData?.title ?? null,
      p_linkedin_url: enrichedData?.linkedin_url ?? null,
      p_intent_score: enrichedData?.intent_score ?? null,
      p_status: status,
    });

    error = response.error;

    if (!error && status === EnrichmentStatus.SUCCESS) {
      await supabase.rpc("rpc_score_lead", {
        p_lead_id: entityId,
      });
    }
  }

  /* ========================================================
     COMPANY PERSISTENCE
  ======================================================== */

  if (type === "company") {
    const response = await supabase.rpc("update_company_enrichment", {
      p_company_id: entityId,
      p_confidence: finalConfidence,
      p_company_name: enrichedData?.company_name ?? null,
      p_website: enrichedData?.website ?? null,
      p_domain: enrichedData?.domain ?? null,
      p_status: status,
    });

    error = response.error;
  }

  if (error) {
    throw error;
  }
}
