import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"
import {
  EnrichmentStrategyExecutor,
  EnrichmentStatus,
  EnrichmentStrategyType,
  EnrichmentContext,
  ClaimedCompany,
} from "../types"

const execFileAsync = promisify(execFile)

const BRICKS_SCRIPT = path.resolve(
  __dirname, "..", "..", "..", "deps", "bricks", "bricks.py"
)

interface BrickEmail {
  email: string
  first_name?: string
  last_name?: string
  full_name?: string
  confidence: number
  source: string
  domain_has_mx?: boolean
  url?: string
}

export const bricksEnrichmentExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext) {
    if (context.type !== "company") {
      return { status: EnrichmentStatus.FAILED, error: "Bricks enrichment only works on companies" }
    }

    const company = context.entity as ClaimedCompany

    if (!company.domain) {
      return { status: EnrichmentStatus.FAILED, error: "Company missing domain" }
    }

    const companyName = company.name || company.domain

    try {
      const { stdout } = await execFileAsync("python3", [
        BRICKS_SCRIPT,
        "email", "find",
        "--company", companyName,
        "--domain", company.domain,
      ], { timeout: 20000 })

      const results: BrickEmail[] = JSON.parse(stdout.trim() || "[]")

      if (!results.length) {
        return {
          status: EnrichmentStatus.PARTIAL,
          data: { confidence: 0, strategy: EnrichmentStrategyType.BRICKS_ENRICHMENT },
        }
      }

      const hasMx = results[0]?.domain_has_mx ?? false
      const best = results.reduce((a, b) => (b.confidence > a.confidence ? b : a))

      const contacts = results.map((r) => ({
        email: r.email,
        first_name: r.first_name || "",
        last_name: r.last_name || "",
        full_name: r.full_name || r.email.split("@")[0],
        confidence: hasMx ? r.confidence : Math.max(0.1, r.confidence - 0.2),
        source: r.source,
      }))

      return {
        status: best.confidence >= 0.5 ? EnrichmentStatus.SUCCESS : EnrichmentStatus.PARTIAL,
        data: {
          email: best.email,
          first_name: best.first_name || "",
          last_name: best.last_name || "",
          full_name: best.full_name || best.email.split("@")[0],
          confidence: hasMx ? best.confidence : Math.max(0.1, best.confidence - 0.2),
          strategy: EnrichmentStrategyType.BRICKS_ENRICHMENT,
          raw: { contacts_found: results.length, all_contacts: contacts, domain_has_mx: hasMx },
        },
      }
    } catch (err: any) {
      return {
        status: EnrichmentStatus.FAILED,
        error: `Bricks subprocess error: ${err.message}`,
      }
    }
  },
}
