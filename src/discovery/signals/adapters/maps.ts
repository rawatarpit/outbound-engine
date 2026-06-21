import pino from "pino"
import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const execFileAsync = promisify(execFile)
const logger = pino({ level: "debug" })

export interface MapsAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
  clientId?: string
}

export async function mapsAdapter(
  config: MapsAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10 } = config

  try {
    const scriptsDir = path.resolve(__dirname, "../../../../open_source")
    const { stdout } = await execFileAsync("python3", [
      path.join(scriptsDir, "search_maps.py"),
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
      source: `maps`,
      source_url: r.url || "",
      risk: DiscoveryRisk.MODERATE_PUBLIC,
      domain: r.domain || "unknown.com",
      name: r.name || r.title || r.domain || "Unknown",
      title: r.title || "",
      summary: r.body || r.name || "",
      signal_type: signal,
      relevance_score: 50,
      urgency_score: 30,
      fit_reason: `OSM map result for: ${query}`,
      raw: {
        query, intent_id, signal,
        lat: r.lat || "",
        lon: r.lon || "",
        category: r.category || "",
        tags: r.tags || {},
        website: r.website || "",
      },
    }))

    logger.info({ query, count: companies.length }, "Maps adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Maps adapter failed")
    return { companies: [], contacts: [] }
  }
}
