import { supabase } from "../db/supabase"

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
      await supabase.from("suppression_list").insert({
        company_id: companyId,
        reason: "Unsubscribe"
      })
    }

    await supabase
      .from("companies")
      .update({ status: "closed_lost" })
      .eq("id", companyId)
  }
}
