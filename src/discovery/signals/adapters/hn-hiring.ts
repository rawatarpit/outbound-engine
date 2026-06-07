import axios from "axios"
import pino from "pino"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

export interface HNHiringAdapterConfig {
  intent_id: string
  signal: string
}

const BIG_CORP_DOMAINS = new Set([
  "google.com", "amazon.com", "microsoft.com", "apple.com", "meta.com",
  "facebook.com", "netflix.com", "uber.com", "airbnb.com", "linkedin.com",
  "twitter.com", "x.com", "salesforce.com", "oracle.com", "ibm.com",
  "intel.com", "cisco.com", "dell.com", "hp.com", "adobe.com",
  "paypal.com", "shopify.com", "square.com", "stripe.com", "cloudflare.com",
  "datadog.com", "snowflake.com", "mongodb.com", "elastic.co", "github.com",
  "gitlab.com", "docker.com", "hashicorp.com", "pagerduty.com", "twilio.com",
  "sendgrid.com", "mailchimp.com", "hubspot.com", "zendesk.com", "atlassian.com",
  "slack.com", "zoom.us", "dropbox.com", "box.com", "notion.so",
  "figma.com", "canva.com", "asana.com", "linear.app",
])

function isBigCorpDomain(domain: string): boolean {
  const main = domain.replace(/^www\./, "").toLowerCase()
  return BIG_CORP_DOMAINS.has(main)
}

function extractDomain(text: string): string | null {
  const match = text.match(/https?:\/\/([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/i)
  if (!match) return null
  return match[1].replace(/^www\./, "")
}

export async function hnHiringAdapter(
  config: HNHiringAdapterConfig
): Promise<DiscoveryResult> {
  const { intent_id, signal } = config

  try {
    const searchRes = await axios.get("https://hn.algolia.com/api/v1/search", {
      params: {
        query: "Ask HN: Who is hiring",
        tags: "story,ask_hn",
        hitsPerPage: 5,
      },
      timeout: 10000,
    })

    const latestThread = searchRes.data?.hits?.[0]
    if (!latestThread) {
      return { companies: [], contacts: [] }
    }

    const threadRes = await axios.get(
      `https://hn.algolia.com/api/v1/items/${latestThread.objectID}`,
      { timeout: 10000 }
    )

    if (!threadRes.data?.children) {
      return { companies: [], contacts: [] }
    }

    const companies: DiscoveryCompany[] = []
    const seen = new Set<string>()

    for (const comment of threadRes.data.children) {
      if (!comment.text) continue
      const text = comment.text as string

      const domain = extractDomain(text)
      if (!domain) continue

      const cleanDomain = domain.replace(/^www\./, "").toLowerCase()
      if (isBigCorpDomain(cleanDomain)) continue
      if (seen.has(cleanDomain)) continue
      seen.add(cleanDomain)

      const companyMatch = text.match(/^([^|]+)\|/)
        ?? text.match(/at\s+([A-Z][a-zA-Z\s]+),/)
      const companyName = companyMatch?.[1]?.trim() ?? cleanDomain

      companies.push({
        source: "hn_hiring",
        source_url: `https://news.ycombinator.com/item?id=${latestThread.objectID}`,
        risk: DiscoveryRisk.MODERATE_PUBLIC,
        domain: cleanDomain,
        name: companyName,
        title: `Hiring: ${companyName}`,
        summary: text.slice(0, 300),
        signal_type: "hiring",
        relevance_score: 75,
        urgency_score: 60,
        fit_reason: "HN Hiring thread — confirmed active hiring",
        raw: { intent_id, signal, hn_thread: latestThread.objectID },
      } as any)
    }

    logger.info({ count: companies.length }, "HN Hiring adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ error: err.message }, "HN Hiring adapter failed")
    return { companies: [], contacts: [] }
  }
}
