import axios from "axios"
import pino from "pino"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"
import { getGithubToken } from "../../utils/api-keys"

const logger = pino({ level: "debug" })

export interface GitHubAdapterConfig {
  query: string
  intent_id: string
  signal: string
  per_page?: number
  clientId?: string
}

export async function githubAdapter(
  config: GitHubAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, per_page = 30, clientId } = config

  const token = await getGithubToken(clientId)
  if (!token) {
    logger.warn("No GITHUB_TOKEN set — skipping GitHub adapter")
    return { companies: [], contacts: [] }
  }

  try {
    const response = await axios.get("https://api.github.com/search/repositories", {
      params: { q: query, sort: "updated", per_page },
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
      timeout: 10000,
    })

    if (!response.data?.items) {
      return { companies: [], contacts: [] }
    }

    const companies: DiscoveryCompany[] = []

    for (const repo of response.data.items) {
      if (repo.owner?.type !== "Organization") continue
      if (repo.stargazers_count < 5) continue

      const orgName = repo.owner.login
      let domain: string | null = null

      try {
        const orgRes = await axios.get(`https://api.github.com/orgs/${orgName}`, {
          headers: { Authorization: `token ${token}` },
          timeout: 5000,
        })
        const blog = orgRes.data?.blog
        if (blog) {
          try {
            domain = new URL(blog).hostname.replace("www.", "")
          } catch {
            domain = null
          }
        }
      } catch {
        // org fetch failed, proceed without domain
      }

      companies.push({
        source: "github",
        source_url: `https://github.com/${orgName}`,
        risk: DiscoveryRisk.MODERATE_PUBLIC,
        domain: domain || `${orgName.toLowerCase()}.com`,
        name: orgName,
        title: repo.description || orgName,
        summary: repo.description || "",
        signal_type: signal,
        relevance_score: 55,
        urgency_score: 35,
        fit_reason: `GitHub org match for: ${query}`,
        raw: { query, intent_id, signal, org: orgName, stars: repo.stargazers_count, repos: repo.owner?.public_repos },
      } as any)
    }

    logger.info({ query, count: companies.length }, "GitHub adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "GitHub adapter failed")
    return { companies: [], contacts: [] }
  }
}
