import pino from "pino"
import { supabase } from "../db/supabase"
import {
  ClaimedContact,
  ClaimedCompany
} from "./types"

const logger = pino({ level: "info" })

/* =========================================================
   CLAIM CONTACTS
========================================================= */

export async function claimContactsForEnrichment(
  brandId: string,
  batchSize: number
): Promise<ClaimedContact[]> {

  const { data, error } = await supabase.rpc(
    "claim_contacts_for_enrichment",
    {
      p_brand_id: brandId,
      p_limit: batchSize
    }
  )

  if (error) throw error

  return (data ?? []) as ClaimedContact[]
}

/* =========================================================
   CLAIM COMPANIES
========================================================= */

export async function claimCompaniesForEnrichment(
  brandId: string,
  batchSize: number
): Promise<ClaimedCompany[]> {
  // Bypass broken RPC claim_companies_for_enrichment that returns [] despite matching records.
  // Instead, SELECT matching records and UPDATE their status atomically.

  const { data: candidates, error: selectError } = await supabase
    .from("discovered_companies")
    .select("id")
    .eq("brand_id", brandId)
    .eq("enrichment_status", "approved")
    .eq("requires_enrichment", true)
    .eq("processed", false)
    .eq("dead_letter", false)
    .is("next_attempt_at", null)
    .limit(batchSize)

  if (selectError) throw selectError
  if (!candidates || candidates.length === 0) return []

  const ids = candidates.map(c => c.id)

  const { data: claimed, error: updateError } = await supabase
    .from("discovered_companies")
    .update({
      enrichment_status: "enriching",
      enrichment_attempts: 1,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids)
    .eq("brand_id", brandId)
    .eq("enrichment_status", "approved")
    .select()

  if (updateError) throw updateError

  logger.info({ brandId, count: claimed?.length || 0 }, "Claimed companies for enrichment (bypass RPC)")

  return (claimed ?? []) as ClaimedCompany[]
}