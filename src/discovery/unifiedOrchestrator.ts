import pino from "pino"
import { startDiscovery } from "./index"
import type { NormalizedOpportunity } from "./core/normalizer"
import { startSignalDiscovery } from "./signals/engine"
import type { BrandProfile } from "../db/supabase"

const logger = pino({ level: "info" })

interface UnifiedDiscoveryResult {
  opportunities: NormalizedOpportunity[]
  sourceDrivenCount: number
  signalDrivenCount: number
  duplicateCount: number
}

/**
 * UnifiedDiscoveryOrchestrator runs both discovery paths in parallel,
 * deduplicates results by domain/name, and shares context across both paths.
 */
export async function runUnifiedDiscovery(
  brandId?: string,
  maxSources: number = 2,
  maxSignalQueries: number = 20
): Promise<UnifiedDiscoveryResult> {
  const startTime = Date.now()
  logger.info("[UNIFIED-DISCOVERY] Starting unified discovery system")

  try {
    // Run both discovery paths in parallel
    const [sourceResults, signalResults] = await Promise.all([
      startDiscovery(brandId, maxSources),
      startSignalDiscovery(brandId, maxSignalQueries)
    ])

    // Deduplicate by domain (preferred) or name
    const seen = new Set<string>()
    const deduplicated: NormalizedOpportunity[] = []

    // Helper to create dedup key
    const makeKey = (opp: NormalizedOpportunity): string => {
      // Prefer domain if available and valid
      if (opp.domain && opp.domain !== "unknown.com" && opp.domain.trim() !== "") {
        return `domain:${opp.domain.toLowerCase().trim()}`
      }
      // Fallback to name
      return `name:${(opp.company || opp.title || "unknown").toLowerCase().trim()}`
    }

    // Add source-driven results first (they come from trusted sources)
    for (const opp of sourceResults) {
      const key = makeKey(opp)
      if (!seen.has(key)) {
        seen.add(key)
        deduplicated.push(opp)
      }
    }

    // Add signal-driven results, skipping duplicates
    let duplicateCount = 0
    for (const opp of signalResults) {
      const key = makeKey(opp)
      if (!seen.has(key)) {
        seen.add(key)
        deduplicated.push(opp)
      } else {
        duplicateCount++
      }
    }

    const duration = Date.now() - startTime
    logger.info(
      {
        source: sourceResults.length,
        signal: signalResults.length,
        duplicates: duplicateCount,
        total: deduplicated.length,
        durationMs: duration
      },
      "Unified discovery completed"
    )

    return {
      opportunities: deduplicated,
      sourceDrivenCount: sourceResults.length,
      signalDrivenCount: signalResults.length,
      duplicateCount: duplicateCount
    }
  } catch (err: any) {
    logger.error({ error: err.message }, "Unified discovery failed")
    return {
      opportunities: [],
      sourceDrivenCount: 0,
      signalDrivenCount: 0,
      duplicateCount: 0
    }
  }
}

// Export for use in index.ts
export { runUnifiedDiscovery as startUnifiedDiscovery }