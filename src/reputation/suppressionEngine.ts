import { supabase } from "../db/supabase"

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
  await supabase.from("suppression_list").insert({
    company_id: companyId,
    reason
  })

  await supabase
    .from("companies")
    .update({ status: "closed_lost" })
    .eq("id", companyId)
}
