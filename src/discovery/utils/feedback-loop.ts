import fs from "fs"
import path from "path"

const FEEDBACK_FILE = path.resolve(process.cwd(), "data", "adapter-feedback.json")

interface AdapterFeedback {
  adapter: string
  query: string
  intentId: string
  runId: string
  rawCount: number
  approvedCount: number
  leadCount: number
  timestamp: number
}

interface FeedbackStore {
  history: AdapterFeedback[]
}

function load(): FeedbackStore {
  try {
    if (fs.existsSync(FEEDBACK_FILE)) {
      return JSON.parse(fs.readFileSync(FEEDBACK_FILE, "utf-8"))
    }
  } catch { /* ignore */ }
  return { history: [] }
}

function save(store: FeedbackStore): void {
  const dir = path.dirname(FEEDBACK_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const recent = store.history.slice(-500)
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify({ history: recent }, null, 2))
}

export function recordAdapterResult(params: {
  adapter: string
  query: string
  intentId: string
  runId: string
  rawCount: number
  approvedCount: number
  leadCount: number
}): void {
  const store = load()
  store.history.push({
    adapter: params.adapter,
    query: params.query,
    intentId: params.intentId,
    runId: params.runId,
    rawCount: params.rawCount,
    approvedCount: params.approvedCount,
    leadCount: params.leadCount,
    timestamp: Date.now(),
  })
  save(store)
}

export function getFeedbackSummary(): string {
  const store = load()
  if (store.history.length === 0) return ""

  const byAdapter: Record<string, { runs: number; totalLeads: number; totalApproved: number }> = {}
  for (const h of store.history) {
    if (!byAdapter[h.adapter]) byAdapter[h.adapter] = { runs: 0, totalLeads: 0, totalApproved: 0 }
    byAdapter[h.adapter].runs++
    byAdapter[h.adapter].totalLeads += h.leadCount
    byAdapter[h.adapter].totalApproved += h.approvedCount
  }

  const lines = Object.entries(byAdapter)
    .sort((a, b) => b[1].totalLeads - a[1].totalLeads)
    .map(([adapter, stats]) =>
      `  - ${adapter}: ${stats.totalLeads} leads from ${stats.runs} queries (${stats.totalApproved} approved)`
    )

  return `\n\nPAST ADAPTER PERFORMANCE (from last ${store.history.length} queries):\n${lines.join("\n")}\n\nUse this data to focus on adapters that produced leads and deprioritize those that didn't.`
}

export function getTopPerformingQueries(limit = 3): string[] {
  const store = load()
  return store.history
    .filter(h => h.leadCount > 0)
    .sort((a, b) => b.leadCount - a.leadCount)
    .slice(0, limit)
    .map(h => `  - adapter:${h.adapter} query:"${h.query}" produced ${h.leadCount} lead(s)`)
}
