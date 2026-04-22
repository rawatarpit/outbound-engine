import type {
  DiscoveryCompany,
  DiscoveryRisk
} from "../../types"
import { normalizeDomain } from "../../normalizer"

/* =========================================================
   RAW GITHUB REPO TYPE (MINIMAL)
========================================================= */

interface GithubRepo {
  name: string
  homepage?: string | null
  html_url: string
  stargazers_count?: number
  owner?: {
    login?: string
  }
}

/* =========================================================
   RISK CLASSIFICATION
========================================================= */

const GITHUB_RISK: DiscoveryRisk =
  "medium" as DiscoveryRisk

/* =========================================================
   TRANSFORM FUNCTION
========================================================= */

export function transformGithubRepoToCompany(
  repo: GithubRepo,
  sourceId: string
): DiscoveryCompany | null {

  if (!repo.homepage) return null

  const domain = normalizeDomain(repo.homepage)
  if (!domain) return null

  return {
    name: repo.owner?.login ?? repo.name,
    domain,

    source: sourceId,
    source_url: repo.html_url,

    risk: GITHUB_RISK,

    confidence: 0.7,

    intent_score: repo.stargazers_count
      ? Math.min(repo.stargazers_count / 10000, 1)
      : 0.1,

    requires_enrichment: true,

    raw: repo
  }
}