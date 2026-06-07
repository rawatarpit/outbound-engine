import pino from "pino"
import { supabase } from "../db/supabase"

const logger = pino({ level: "info" })

export async function isSuppressed(companyId: string): Promise<boolean> {
  const { data } = await supabase
    .from("suppression_list")
    .select("id")
    .eq("company_id", companyId)
    .maybeSingle()

  return !!data
}

export async function suppressCompany(
  companyId: string,
  reason: string
) {
  const { error: insertError } = await supabase.from("suppression_list").insert({
    company_id: companyId,
    reason
  })

  if (insertError) {
    logger.error(
      { companyId, reason, error: insertError.message },
      "Failed to insert suppression record"
    )
  }

  const { error: updateError } = await supabase
    .from("companies")
    .update({ status: "closed_lost" })
    .eq("id", companyId)

  if (updateError) {
    logger.error(
      { companyId, error: updateError.message },
      "Failed to update company status"
    )
  }
}
