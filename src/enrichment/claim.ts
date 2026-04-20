import { supabase } from "../db/supabase"
import {
  ClaimedContact,
  ClaimedCompany
} from "./types"

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

  const { data, error } = await supabase.rpc(
    "claim_companies_for_enrichment",
    {
      p_brand_id: brandId,
      p_batch_size: batchSize
    }
  )

  if (error) throw error

  return (data ?? []) as ClaimedCompany[]
}