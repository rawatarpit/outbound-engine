import { execFile } from "child_process"
import { promisify } from "util"
import fs from "fs"
import path from "path"
import os from "os"
import pino from "pino"

const execFileAsync = promisify(execFile)
const logger = pino({ level: "info" })

export interface ForgeEnrichResult {
  domain: string
  company_name: string
  industry?: string
  tech_stack?: string[]
  employees?: number
  revenue?: string
  emails?: string[]
  social_links?: string[]
  summary?: string
}

export async function enrichCompanyViaForge(
  companyName: string,
  domain: string,
): Promise<ForgeEnrichResult | null> {
  // FORGE expects a CSV file with company data
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-"))
  const inputCsv = path.join(tmpDir, "input.csv")
  const outputCsv = path.join(tmpDir, "output.csv")

  try {
    fs.writeFileSync(inputCsv, `name,domain\n${companyName},${domain}\n`)

    const { stdout } = await execFileAsync("forge", [
      "enrich",
      "--file", inputCsv,
      "--output", outputCsv,
      "--mode", "web",
      "--workers", "1",
    ], { timeout: 120000 })

    logger.info({ company: companyName, domain, output: stdout.substring(0, 200) }, "FORGE enrichment completed")

    if (fs.existsSync(outputCsv)) {
      const output = fs.readFileSync(outputCsv, "utf-8")
      const lines = output.trim().split("\n")
      if (lines.length > 1) {
        const headers = lines[0].split(",")
        const values = lines[1].split(",")
        const record: Record<string, string> = {}
        headers.forEach((h, i) => { record[h.trim()] = (values[i] || "").trim() })

        return {
          domain,
          company_name: record["name"] || companyName,
          industry: record["industry"] || undefined,
          tech_stack: record["tech_stack"] ? record["tech_stack"].split(";") : undefined,
          employees: record["employees"] ? parseInt(record["employees"]) : undefined,
          revenue: record["revenue"] || undefined,
          emails: record["emails"] ? record["emails"].split(";") : undefined,
          summary: record["summary"] || undefined,
        }
      }
    }

    return null
  } catch (err: any) {
    logger.warn({ company: companyName, domain, error: err.message }, "FORGE enrichment failed")
    return null
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch { /* ignore cleanup errors */ }
  }
}
