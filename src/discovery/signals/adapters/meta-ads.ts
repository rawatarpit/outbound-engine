import pino from "pino"
import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const execFileAsync = promisify(execFile)
const logger = pino({ level: "debug" })

export interface MetaAdsAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
  clientId?: string
}

export async function metaAdsAdapter(
  config: MetaAdsAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10 } = config

  try {
    const scriptsDir = path.resolve(__dirname, "../../../../open_source")
    const { stdout } = await execFileAsync("python3", [
      path.join(scriptsDir, "search_ads.py"),
      JSON.stringify({
        queries: [{ text: query, signal, intent_id }],
        max_results,
      }),
    ], {
      timeout: 60000,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || ""}` },
    })

    const result = JSON.parse(stdout.trim())
    const items = result.companies || []

    const companies: DiscoveryCompany[] = items.map((r: any) => ({
      source: `meta_ads`,
      source_url: r.url || "",
      risk: DiscoveryRisk.MODERATE_PUBLIC,
      domain: r.domain || "unknown.com",
      name: r.title || r.company || r.domain || "Unknown",
      title: r.title || "",
      summary: r.body || r.title || "",
      signal_type: signal,
      relevance_score: 50,
      urgency_score: 30,
      fit_reason: `Meta Ad Library result for: ${query}`,
      raw: { query, intent_id, signal, page_name: r.page_name || "" },
    }))

    logger.info({ query, count: companies.length }, "Meta Ads adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Meta Ads adapter failed")
    return { companies: [], contacts: [] }
  }
}
