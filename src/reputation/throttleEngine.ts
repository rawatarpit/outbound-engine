import { supabase } from "../db/supabase"

export async function checkRampLimit(product: string): Promise<boolean> {
  const { data } = await supabase
    .from("brand_profiles")
    .select("daily_cap, current_day_sent")
    .eq("product", product)
    .single()

  if (!data) return true

  return data.current_day_sent < data.daily_cap
}
