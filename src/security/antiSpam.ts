import pino from "pino"
import { supabase } from "../db/supabase"

const logger = pino({ level: "info" })

export async function autoSuppress(
  companyId: string,
  intent: string,
  raw: string
) {
  const lower = raw.toLowerCase()

  if (
    intent === "unsubscribe" ||
    lower.includes("unsubscribe") ||
    lower.includes("remove me")
  ) {
    const { data: exists } = await supabase
      .from("suppression_list")
      .select("id")
      .eq("company_id", companyId)
      .maybeSingle()

    if (!exists) {
      const { error: insertError } = await supabase.from("suppression_list").insert({
        company_id: companyId,
        reason: "Unsubscribe"
      })

      if (insertError) {
        logger.error(
          { companyId, error: insertError.message },
          "Failed to insert suppression record"
        )
      }
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
}
