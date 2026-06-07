import axios from "axios"
import { load } from "cheerio"
import pino from "pino"
import dns from "dns"
import {
  EnrichmentStrategyExecutor,
  EnrichmentStatus,
  EnrichmentStrategyType,
  EnrichmentContext,
  ClaimedCompany,
} from "../types"
import { isValidPersonalEmail } from "../utils/email-validator"

const logger = pino({ level: "info" })

const TEAM_PATHS = ["/about", "/team", "/company", "/leadership", "/about-us", "/people", "/our-team"]

const NAME_EMAIL_PATTERN = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-\s]*[\w._%+-]+@[\w.-]+\.\w{2,}/g
const EMAIL_ONLY_PATTERN = /[\w._%+-]+@[\w.-]+\.\w{2,}/g

function domainHasMx(domain: string): Promise<boolean> {
  return new Promise((resolve) => {
    dns.resolveMx(domain, (err, mx) => {
      resolve(!err && !!mx && mx.length > 0)
    })
  })
}

function extractEmails(text: string, domain: string): string[] {
  const emails: string[] = []
  const seen = new Set<string>()
  const matches = text.match(EMAIL_ONLY_PATTERN) || []
  for (const raw of matches) {
    const email = raw.toLowerCase().trim()
    if (!email.endsWith(`@${domain.toLowerCase()}`)) continue
    if (!isValidPersonalEmail(email)) continue
    if (seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

function extractNames(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const matches = text.matchAll(NAME_EMAIL_PATTERN)
  for (const m of matches) {
    const name = m[1].trim()
    if (name.length > 3 && name.length < 60 && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

function inferEmail(firstName: string, lastName: string, domain: string): string | null {
  const patterns = [
    `${firstName}.${lastName}@${domain}`,
    `${firstName}@${domain}`,
    `${firstName[0]}.${lastName}@${domain}`,
    `${firstName}${lastName}@${domain}`,
  ]
  return patterns[0]
}

export const websiteScrapeExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext): Promise<any> {
    const { type, entity } = context

    if (type !== "company") {
      return { status: EnrichmentStatus.FAILED, error: "Website scrape only works on companies" }
    }

    const company = entity as ClaimedCompany

    if (!company.domain) {
      return { status: EnrichmentStatus.FAILED, error: "Company missing domain" }
    }

    const hasMx = await domainHasMx(company.domain)
    if (!hasMx) {
      logger.info({ domain: company.domain }, "No MX records — skipping website scrape")
      return { status: EnrichmentStatus.PARTIAL, data: { confidence: 0, strategy: EnrichmentStrategyType.WEBSITE_SCRAPE } }
    }

    const foundEmails: string[] = []
    const foundNames: string[] = []

    for (const teamPath of TEAM_PATHS) {
      const urls = [`https://${company.domain}${teamPath}`, `https://www.${company.domain}${teamPath}`]
      for (const url of urls) {
        let text: string | null = null

        try {
          const { data } = await axios.get(url, { timeout: 8000, validateStatus: (s) => s < 500 })
          if (typeof data === "string") {
            const $ = load(data)
            $("script, style, noscript, nav, footer, header").remove()
            text = $("body").text().replace(/\s+/g, " ").trim()
          }
        } catch {
          /* try playwright fallback */
        }

        if (!text || text.length < 100) {
          try {
            const { chromium } = await import("playwright")
            const browser = await chromium.launch({ headless: true })
            try {
              const page = await browser.newPage()
              await page.goto(url, { waitUntil: "networkidle", timeout: 15000 })
              text = await page.evaluate(() => document.body.innerText)
            } finally {
              await browser.close()
            }
          } catch {
            continue
          }
        }

        if (!text) continue

        const emails = extractEmails(text, company.domain)
        for (const e of emails) {
          if (!foundEmails.includes(e)) foundEmails.push(e)
        }
        const names = extractNames(text)
        for (const n of names) {
          if (!foundNames.includes(n)) foundNames.push(n)
        }
      }
    }

    const contacts: any[] = []

    for (const email of foundEmails) {
      const [local] = email.split("@")
      const parts = local.replace(/[._-]/g, " ").split(" ")
      if (parts.length < 1) continue
      const firstName = parts[0]
      const lastName = parts.slice(1).join(" ") || "Unknown"
      const fullName = `${firstName} ${lastName}`.trim()
      contacts.push({
        full_name: firstName.charAt(0).toUpperCase() + firstName.slice(1),
        first_name: firstName.charAt(0).toUpperCase() + firstName.slice(1),
        last_name: lastName.charAt(0).toUpperCase() + lastName.slice(1),
        title: "Team Member",
        email,
        confidence: 0.7,
      })
    }

    for (const name of foundNames) {
      if (contacts.some((c: any) => c.full_name.toLowerCase() === name.toLowerCase())) continue
      const parts = name.split(" ")
      if (parts.length < 2) continue
      const firstName = parts[0]
      const lastName = parts.slice(1).join(" ")
      const inferred = inferEmail(firstName, lastName, company.domain)
      if (!inferred) continue
      contacts.push({
        full_name: name,
        first_name: firstName,
        last_name: lastName,
        title: "Team Member",
        email: inferred,
        confidence: 0.45,
      })
    }

    if (contacts.length === 0) {
      logger.info({ domain: company.domain }, "No contacts found via website scrape")
      return { status: EnrichmentStatus.PARTIAL, data: { confidence: 0, strategy: EnrichmentStrategyType.WEBSITE_SCRAPE } }
    }

    const primary = contacts[0]
    logger.info({ domain: company.domain, contactCount: contacts.length, primary: primary.full_name }, "Website scrape found contacts")

    return {
      status: primary.confidence >= 0.6 ? EnrichmentStatus.SUCCESS : EnrichmentStatus.PARTIAL,
      data: {
        first_name: primary.first_name,
        last_name: primary.last_name,
        full_name: primary.full_name,
        email: primary.email,
        title: primary.title,
        confidence: primary.confidence,
        strategy: EnrichmentStrategyType.WEBSITE_SCRAPE,
        raw: { contacts_found: contacts.length, all_contacts: contacts },
      },
    }
  },
}
