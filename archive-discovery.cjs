const { createClient } = require("@supabase/supabase-js")
const { execSync } = require("child_process")

const SUPABASE_URL = process.env.SUPABASE_URL || "https://xtobbvffaxoiadserkbb.supabase.co"
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_KEY) {
  console.error("Fatal: SUPABASE_SERVICE_ROLE_KEY environment variable is required")
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function pg(sql) {
  const cmd = `PGPASSWORD=archive_pass_2026 psql -h localhost -U archive_user -d outbound_archive -c ${JSON.stringify(sql)}`
  execSync(cmd, { stdio: "pipe", env: { ...process.env, PGSSLMODE: "disable" } })
}

function esc(val) {
  if (val === null || val === undefined) return "NULL"
  if (typeof val === "number") return String(val)
  const s = String(val).replace(/'/g, "''").replace(/\\/g, "\\\\")
  return `'${s}'`
}

async function archiveQueryLogs() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("discovery_query_log")
    .select("*")
    .lt("generated_at", cutoff)
    .limit(50000)

  if (error) { console.warn("query_log fetch error:", error.message); return }
  if (!data || data.length === 0) { console.log("No old query logs"); return }

  let inserted = 0
  for (const row of data) {
    try {
      const sql = `INSERT INTO archived_query_logs (original_id, brand_id, intent_id, intent_text, adapter, query, source_domain, raw_count, approved_count, lead_count, generated_at, run_id) VALUES (${esc(row.id)}, ${esc(row.brand_id)}, ${esc(row.intent_id)}, ${esc(row.intent_text)}, ${esc(row.adapter)}, ${esc(row.query)}, ${esc(row.source_domain)}, ${row.raw_count ?? 0}, ${row.approved_count ?? 0}, ${row.lead_count ?? 0}, ${esc(row.generated_at)}, ${esc(row.run_id)})`
      pg(sql)
      inserted++
    } catch (err) { /* skip problematic rows */ }
  }

  const { error: delError } = await supabase
    .from("discovery_query_log")
    .delete()
    .lt("generated_at", cutoff)

  if (delError) console.warn("delete error:", delError.message)
  else console.log(`Archived ${inserted} query logs (${data.length} total fetched)`)
}

async function archiveRawPayloads() {
  const { data, error } = await supabase
    .from("discovered_companies")
    .select("id, name, domain, brand_id, raw_payload")
    .eq("processed", true)
    .limit(50000)

  if (error) { console.warn("payload fetch error:", error.message); return }
  if (!data || data.length === 0) { console.log("No processed companies"); return }

  let inserted = 0
  for (const row of data) {
    if (!row.raw_payload) continue
    try {
      const payload = JSON.stringify(row.raw_payload).replace(/'/g, "''")
      const sql = `INSERT INTO archived_raw_payloads (company_id, name, domain, brand_id, raw_payload) VALUES (${esc(row.id)}, ${esc(row.name)}, ${esc(row.domain)}, ${esc(row.brand_id)}, '${payload}'::jsonb)`
      pg(sql)
      inserted++
    } catch (err) { /* skip */ }
  }

  const { error: updateError } = await supabase
    .from("discovered_companies")
    .update({ raw_payload: null })
    .eq("processed", true)

  if (updateError) console.warn("nullify error:", updateError.message)
  else console.log(`Archived ${inserted} raw_payloads`)
}

async function archiveResearchContent() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("research")
    .select("id, company_id, brand_id, raw_content")
    .lt("created_at", cutoff)
    .not("raw_content", "is", null)
    .limit(50000)

  if (error) { console.warn("research fetch error:", error.message); return }
  if (!data || data.length === 0) { console.log("No old research content"); return }

  let inserted = 0
  for (const row of data) {
    if (!row.raw_content) continue
    try {
      const sql = `INSERT INTO archived_research_content (research_id, company_id, brand_id, raw_content) VALUES (${esc(row.id)}, ${esc(row.company_id)}, ${esc(row.brand_id)}, ${esc(row.raw_content)})`
      pg(sql)
      inserted++
    } catch (err) { /* skip */ }
  }

  const { error: updateError } = await supabase
    .from("research")
    .update({ raw_content: null })
    .lt("created_at", cutoff)
    .not("raw_content", "is", null)

  if (updateError) console.warn("research nullify error:", updateError.message)
  else console.log(`Archived ${inserted} research contents`)
}

async function cleanupOldRejected() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("discovered_companies")
    .select("id")
    .eq("processed", false)
    .neq("enrichment_status", "raw")
    .lt("discovered_at", cutoff)
    .limit(50000)

  if (error) { console.warn("rejected fetch error:", error.message); return }
  if (!data || data.length === 0) { console.log("No old rejected companies"); return }

  const { error: delError } = await supabase
    .from("discovered_companies")
    .delete()
    .eq("processed", false)
    .neq("enrichment_status", "raw")
    .lt("discovered_at", cutoff)

  if (delError) console.warn("rejected delete error:", delError.message)
  else console.log(`Deleted ${data.length} old rejected/abandoned companies`)
}

async function main() {
  const start = Date.now()
  console.log("=== Daily archival run ===", new Date().toISOString())

  try {
    await archiveQueryLogs()
    await archiveRawPayloads()
    await archiveResearchContent()
    await cleanupOldRejected()
  } catch (err) {
    console.error("Archive failed:", err.message)
  }

  console.log("=== Complete ===", new Date().toISOString(), `(${Date.now() - start}ms)`)
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1) })
