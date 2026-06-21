import pino from "pino"
import { getClientLLMSettings } from "../db/supabase"
import * as CFG from "./discovery"

const logger = pino({ level: "info" })

export interface BrandDiscoveryConfig {
  targetRegions: typeof CFG.TARGET_REGIONS
  nonTargetRegions: typeof CFG.NON_TARGET_REGIONS
  providerTlds: Set<string>
  aggregatorPlatforms: Set<string>
  mediaDomains: Set<string>
  enterpriseDomains: Set<string>
  enterpriseKeywords: string[]
  providerContentIndicators: string[]
  enterpriseIndicators: RegExp[]
  smallBizIndicators: RegExp[]
  pureTechIndicators: RegExp[]
  b2bIndicators: RegExp[]
  scoringThresholds: typeof CFG.SCORING_THRESHOLDS
  embeddingConfig: typeof CFG.EMBEDDING_CONFIG
}

export async function getBrandDiscoveryConfig(clientId?: string): Promise<BrandDiscoveryConfig> {
  let overrides: Record<string, any> = {}

  if (clientId) {
    try {
      const settings = await getClientLLMSettings(clientId)
      if (settings?.config) {
        const raw = (settings.config as Record<string, any>).discovery
        if (raw) overrides = raw as Record<string, any>
      }
    } catch (err: any) {
      logger.warn({ clientId, err: err.message }, "Failed to load brand discovery overrides, using defaults")
    }
  }

  return {
    targetRegions: CFG.TARGET_REGIONS,
    nonTargetRegions: CFG.NON_TARGET_REGIONS,
    providerTlds: new Set(CFG.PROVIDER_TLDS),
    aggregatorPlatforms: new Set(CFG.KNOWN_AGGREGATOR_PLATFORMS),
    mediaDomains: new Set(CFG.MEDIA_DOMAINS),
    enterpriseDomains: new Set(CFG.ENTERPRISE_DOMAINS),
    enterpriseKeywords: CFG.ENTERPRISE_KEYWORDS,
    providerContentIndicators: CFG.PROVIDER_CONTENT_INDICATORS,
    enterpriseIndicators: CFG.ENTERPRISE_INDICATORS,
    smallBizIndicators: CFG.SMALL_BIZ_INDICATORS,
    pureTechIndicators: CFG.PURE_TECH_INDICATORS,
    b2bIndicators: CFG.B2B_INDUSTRY_INDICATORS,
    scoringThresholds: CFG.SCORING_THRESHOLDS,
    embeddingConfig: CFG.EMBEDDING_CONFIG,
  }
}
