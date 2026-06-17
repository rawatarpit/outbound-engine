import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL || "https://xtobbvffaxoiadserkbb.supabase.co"
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) {
  console.error("Fatal: SUPABASE_SERVICE_ROLE_KEY environment variable required")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const start = Date.now()

async function step(label, fn) {
  console.log(`\n--- ${label} ---`)
  const { count, error } = await fn()
  if (error) {
    console.error(`  FAILED: ${error.message}`)
    return
  }
  console.log(`  Done (${count ?? "?"} rows affected)`)
}

async function cleanupResearchContent() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("research")
    .update({ raw_content: null })
    .lt("created_at", cutoff)
    .not("raw_content", "is", null)
  if (error) return { error, count: 0 }
  const { count } = await supabase
    .from("research")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoff)
    .is("raw_content", null)
  return { count, error: null }
}

async function cleanupDiscoveredPayloads() {
  const { data, error } = await supabase
    .from("discovered_companies")
    .update({ raw_payload: null })
    .eq("processed", true)
    .not("raw_payload", "is", null)
  if (error) return { error, count: 0 }
  const { count } = await supabase
    .from("discovered_companies")
    .select("id", { count: "exact", head: true })
    .eq("processed", true)
    .is("raw_payload", null)
  return { count, error: null }
}

async function deleteOldRejected() {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("discovered_companies")
    .delete()
    .eq("processed", false)
    .neq("enrichment_status", "raw")
    .lt("discovered_at", cutoff)
  if (error) return { error, count: 0 }
  return { count: data?.length ?? 0, error: null }
}

async function cleanupQueryLogs() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("discovery_query_log")
    .delete()
    .lt("generated_at", cutoff)
  if (error) return { error, count: 0 }
  return { count: data?.length ?? 0, error: null }
}

console.log("=== Supabase Storage Cleanup ===", new Date().toISOString())

await step("Nullify research.raw_content (age > 7d)", cleanupResearchContent)
await step("Nullify discovered_companies.raw_payload (processed)", cleanupDiscoveredPayloads)
await step("Delete rejected discovered_companies (age > 14d)", deleteOldRejected)
await step("Delete old discovery_query_log (age > 7d)", cleanupQueryLogs)

console.log(`\n=== Complete === (${Date.now() - start}ms)`)
