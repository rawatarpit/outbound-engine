import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const execFileAsync = promisify(execFile);

const SCRIPTS_DIR = path.join(__dirname, "..", "..", "scripts");

export interface BrowserContact {
  email?: string;
  name?: string;
  title?: string;
  linkedin?: string;
  phone?: string;
  source?: string;
}

export interface BrowserEnrichResult {
  success: boolean;
  contacts: BrowserContact[];
  domain: string;
  error?: string;
}

export async function runBrowserEnrich(
  domain: string,
  companyName: string,
  timeoutMs: number = 90000,
): Promise<BrowserEnrichResult> {
  const params = { domain, company_name: companyName };

  try {
    const { stdout } = await execFileAsync(
      "python3",
      [path.join(SCRIPTS_DIR, "browser_enrich.py"), JSON.stringify(params)],
      { timeout: timeoutMs, env: { ...process.env } },
    );

    const result = JSON.parse(stdout.trim()) as BrowserEnrichResult;
    logger.info({ domain, contactsFound: result.contacts?.length, success: result.success }, "Browser enrich completed");
    return result;
  } catch (err: any) {
    logger.warn({ domain, err: err.message }, "Browser enrich failed");
    return { success: false, contacts: [], domain, error: err.message };
  }
}
