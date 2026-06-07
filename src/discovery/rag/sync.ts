import pino from "pino"
import { supabase, type BrandProfile } from "../../db/supabase"
import { syncBrandEmbeddings } from "./embedder"

const logger = pino({ level: "info" })

export async function syncAllBrandEmbeddings(): Promise<number> {
  const { data: brands, error } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("is_active", true)

  if (error) {
    logger.error({ error: error.message }, "Failed to fetch brands for embedding sync")
    return 0
  }

  const activeBrands = (brands ?? []) as BrandProfile[]
  let totalSynced = 0

  for (const brand of activeBrands) {
    const { data: intents } = await supabase
      .from("brand_intents")
      .select("*")
      .eq("brand_id", brand.id)
      .eq("is_active", true)

    if (!intents?.length) continue

    const clientId = (brand as any).client_id || undefined
    const synced = await syncBrandEmbeddings(brand, intents as any, clientId)
    totalSynced += synced
  }

  logger.info({ totalBrands: activeBrands.length, totalSynced }, "All brand embeddings synced")
  return totalSynced
}
