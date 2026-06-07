import {
  EnrichmentStrategyExecutor,
  EnrichmentStrategyType
} from "../types"

import { apiEnrichmentExecutor } from "./apiEnrichment"
import { emailPatternExecutor } from "./emailPattern"
import { companyResearchExecutor } from "./companyResearch"
import { llmResearchExecutor } from "../llm/researchAgent"
import { contactDiscoveryExecutor } from "./contactDiscovery"
import { websiteScrapeExecutor } from "./websiteScrape"
import { apolloEnrichmentExecutor } from "./apolloEnrichment"
import { hunterEnrichmentExecutor } from "./hunterEnrichment"
import { prospeoEnrichmentExecutor } from "./prospeoEnrichment"

const registry = new Map<
  EnrichmentStrategyType,
  EnrichmentStrategyExecutor
>()

registry.set(
  EnrichmentStrategyType.API_ENRICHMENT,
  apiEnrichmentExecutor
)

registry.set(
  EnrichmentStrategyType.EMAIL_PATTERN,
  emailPatternExecutor
)

registry.set(
  EnrichmentStrategyType.COMPANY_RESEARCH,
  companyResearchExecutor
)

registry.set(
  EnrichmentStrategyType.LLM_RESEARCH,
  llmResearchExecutor
)

registry.set(
  EnrichmentStrategyType.CONTACT_DISCOVERY,
  contactDiscoveryExecutor
)

registry.set(
  EnrichmentStrategyType.WEBSITE_SCRAPE,
  websiteScrapeExecutor
)

registry.set(
  EnrichmentStrategyType.API_CONTACT_ENRICHMENT,
  apolloEnrichmentExecutor
)

registry.set(
  EnrichmentStrategyType.HUNTER_ENRICHMENT,
  hunterEnrichmentExecutor
)

registry.set(
  EnrichmentStrategyType.PROSPEO_ENRICHMENT,
  prospeoEnrichmentExecutor
)

export function getStrategyExecutor(
  type: EnrichmentStrategyType
) {
  return registry.get(type) ?? null
}
