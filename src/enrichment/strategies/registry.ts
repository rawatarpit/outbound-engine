import {
  EnrichmentStrategyExecutor,
  EnrichmentStrategyType
} from "../types"

import { apiEnrichmentExecutor } from "./apiEnrichment"
import { emailPatternExecutor } from "./emailPattern"
import { companyResearchExecutor } from "./companyResearch"
import { llmResearchExecutor } from "../llm/researchAgent"

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

export function getStrategyExecutor(
  type: EnrichmentStrategyType
) {
  return registry.get(type) ?? null
}
