import { z } from "zod"
import pino from "pino"
import { generateStructured } from "../../llm/ollama"
import { executeScraplingSearch } from "../../core/utils/scrapling"
import { scrapeUrl } from "../../core/utils/scraper"
import type { DiscoveredContact } from "./finder"

const logger = pino({ level: "debug" })

const contactExtractSchema = z.object({
  contacts: z.array(z.object({
    full_name: z.string(),
    title: z.string(),
    linkedin_url: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })),
})

const DECISION_MAKER_TITLES = [
  /\b(ceo|chief\s+executive\s+officer)\b/i,
  /\b(cto|chief\s+technology\s+officer)\b/i,
  /\b(cmo|chief\s+marketing\s+officer)\b/i,
  /\b(coo|chief\s+operating\s+officer)\b/i,
  /\b(cfo|chief\s+financial\s+officer)\b/i,
  /\b(cro|chief\s+revenue\s+officer)\b/i,
  /\bvp\s+of\s+/i,
  /\bvice\s+president\s+of\s+/i,
  /\bdirector\s+of\s+/i,
  /\bhead\s+of\s+/i,
  /\bfounder\b/i,
  /\bco-founder\b/i,
  /\bpresident\b/i,
  /\bowner\b/i,
]

function isDecisionMaker(title: string): boolean {
  return DECISION_MAKER_TITLES.some(p => p.test(title))
}

async function scrapeWebsite(url: string): Promise<string | null> {
  try {
    const html = await scrapeUrl(url)
    if (!html) return null
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    return text.substring(0, 8000)
  } catch {
    return null
  }
}

export async function findContactsViaLLM(
  companyName: string,
  domain: string,
  industry?: string,
): Promise<DiscoveredContact[]> {
  const contacts: DiscoveredContact[] = []

  // 1. Try to find and scrape the team page
  const teamUrls = [
    `https://${domain}/team`,
    `https://${domain}/about`,
    `https://${domain}/company/team`,
    `https://${domain}/leadership`,
    `https://${domain}/people`,
  ]

  let pageContent: string | null = null
  for (const url of teamUrls) {
    pageContent = await scrapeWebsite(url)
    if (pageContent && pageContent.length > 200) {
      logger.info({ url, length: pageContent.length }, "Found team page content")
      break
    }
  }

  // 2. If no team page found, search for one
  if (!pageContent) {
    const searchResults = await executeScraplingSearch(
      `"${companyName}" team OR leadership OR "our team" site:${domain}`,
      "google",
      5,
    )
    for (const r of searchResults) {
      if (r.url && new URL(r.url).hostname.replace("www.", "") === domain) {
        pageContent = await scrapeWebsite(r.url)
        if (pageContent && pageContent.length > 200) break
      }
    }
  }

  // 3. Extract contacts via LLM from team page content
  if (pageContent) {
    try {
      const prompt = `Extract leadership/decision-maker contacts from this company website text.

Company: ${companyName}
Domain: ${domain}
${industry ? `Industry: ${industry}` : ""}

Website Text:
${pageContent.substring(0, 6000)}

Extract all leadership team members (C-suite, VP, Director, Head of, Founder). For each person, provide:
- full_name
- title
- linkedin_url (only if found in the text, otherwise null)
- confidence (0.0-1.0 based on how clearly the name and title are stated)

Focus on senior roles: CEO, CTO, CMO, COO, CFO, VP of, Director of, Head of, Founder, President, Owner.`

      const result = await generateStructured(prompt, contactExtractSchema, 0, undefined, 500) as z.infer<typeof contactExtractSchema>

      for (const c of result.contacts) {
        if (!isDecisionMaker(c.title)) continue
        const nameParts = c.full_name.split(" ")
        contacts.push({
          full_name: c.full_name,
          first_name: nameParts[0] || c.full_name,
          last_name: nameParts.slice(1).join(" ") || "Unknown",
          title: c.title,
          linkedin_url: c.linkedin_url || undefined,
          confidence: Math.min(c.confidence + 0.1, 1.0),
          reasoning: `Extracted from ${domain} website`,
          source: "team_page",
          discoveredAt: Date.now(),
          consent_status: "unknown",
        })
      }
    } catch (err: any) {
      logger.warn({ company: companyName, error: err.message }, "LLM contact extraction failed")
    }
  }

  // 4. Fallback: search for LinkedIn profiles via web search
  if (contacts.length === 0) {
    try {
      const linkedinResults = await executeScraplingSearch(
        `site:linkedin.com/in/ "${companyName}" CEO OR Founder OR CTO OR VP`,
        "google",
        10,
      )

      for (const r of linkedinResults) {
        const title = r.title || ""
        const url = r.url || ""
        if (!url.includes("linkedin.com/in/")) continue

        // Try to extract name + title from LinkedIn search result
        const match = title.match(/^(.+?)\s*[–-]\s*(.+?)\s+(?:-|at|&)\s+/)
        const name = match?.[1]?.trim() || ""
        const role = match?.[2]?.trim() || ""

        if (name && role && isDecisionMaker(role)) {
          const nameParts = name.split(" ")
          contacts.push({
            full_name: name,
            first_name: nameParts[0],
            last_name: nameParts.slice(1).join(" ") || "Unknown",
            title: role,
            linkedin_url: url.split("?")[0].split("#")[0],
            confidence: 0.5,
            reasoning: "Found via LinkedIn search",
            source: "linkedin",
            discoveredAt: Date.now(),
            consent_status: "unknown",
          })
        }
      }
    } catch (err: any) {
      logger.warn({ company: companyName, error: err.message }, "LinkedIn search failed")
    }
  }

  logger.info({ company: companyName, contacts: contacts.length }, "LLM contact enrichment completed")
  return contacts
}
