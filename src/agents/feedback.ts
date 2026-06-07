import pino from "pino"
import { supabase, type BrandProfile } from "../db/supabase"
import { syncAllBrandEmbeddings } from "../discovery/rag/sync"
import {
  createRunId,
  logAgentTurn,
  structuredError,
} from "../harness"

const logger = pino({ level: "info" })

interface FeedbackAgentResult {
  brandsProcessed: number
  intentsUpdated: number
  outcomesProcessed: number
  embeddingsSynced: number
}

export async function runFeedbackAgent(): Promise<FeedbackAgentResult> {
  const runId = createRunId("feedback")
  const startTime = Date.now()
  logger.info("[FEEDBACK AGENT] Starting feedback cycle")

  let brandsProcessed = 0
  let intentsUpdated = 0
  let outcomesProcessed = 0
  let embeddingsSynced = 0
  const toolErrors: string[] = []

  try {
    const { data: brands } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("is_active", true)

    if (!brands || brands.length === 0) {
      logger.warn("No active brands found for feedback processing")
      return { brandsProcessed: 0, intentsUpdated: 0, outcomesProcessed: 0, embeddingsSynced: 0 }
    }

    logger.info({ count: brands.length }, "Processing brands for feedback")

    for (const brand of brands) {
      try {
        const brandResult = await processBrandFeedback(brand)
        brandsProcessed++
        intentsUpdated += brandResult.intentsUpdated
        outcomesProcessed += brandResult.outcomesProcessed
        embeddingsSynced += brandResult.embeddingsSynced ? 1 : 0
      } catch (err: any) {
        toolErrors.push(`Brand ${brand.brand_name}: ${err.message}`)
        logger.error({ error: err.message, brand: brand.brand_name }, "Brand feedback processing failed")
        continue
      }
    }

    const duration = Date.now() - startTime

    logAgentTurn({
      run_id: runId,
      agent_id: "feedback",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: 0,
      output_tokens: 0,
      tools_called: ["process_outcomes", "update_intents", "sync_embeddings"],
      tool_latencies_ms: { feedback_cycle: duration },
      tool_errors: toolErrors,
      stop_reason: "completed",
      cost_usd: 0,
      context_utilization_pct: 0,
    })

    logger.info(
      { brandsProcessed, intentsUpdated, outcomesProcessed, embeddingsSynced, durationMs: duration },
      "[FEEDBACK AGENT] Feedback cycle completed",
    )

    return { brandsProcessed, intentsUpdated, outcomesProcessed, embeddingsSynced }
  } catch (err: any) {
    logger.error({ error: err.message }, "Feedback agent failed")

    logAgentTurn({
      run_id: runId,
      agent_id: "feedback",
      turn: 1,
      timestamp: new Date().toISOString(),
      input_tokens: 0,
      output_tokens: 0,
      tools_called: [],
      tool_latencies_ms: {},
      tool_errors: [structuredError({ tool: "feedback_cycle", message: err.message })],
      stop_reason: "error",
      cost_usd: 0,
      context_utilization_pct: 0,
    })

    return { brandsProcessed: 0, intentsUpdated: 0, outcomesProcessed: 0, embeddingsSynced: 0 }
  }
}

async function processBrandFeedback(brand: BrandProfile): Promise<{
  intentsUpdated: number
  outcomesProcessed: number
  embeddingsSynced: number
}> {
  let intentsUpdated = 0
  let outcomesProcessed = 0
  let embeddingsSynced = 0

  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: recentCompanies } = await supabase
    .from("companies")
    .select("id, status, intent_id, relevance_score, updated_at")
    .eq("brand_id", brand.id)
    .in("status", ["closed_won", "rejected", "closed_lost"])
    .gte("updated_at", cutoffTime)

  if (!recentCompanies || recentCompanies.length === 0) {
    return { intentsUpdated: 0, outcomesProcessed: 0, embeddingsSynced: 0 }
  }

  logger.info({ brand: brand.brand_name, count: recentCompanies.length }, "Processing recent outcomes")

  const intentOutcomes: Record<string, { won: number; lost: number; totalScore: number }> = {}

  for (const company of recentCompanies) {
    const intentId = company.intent_id
    if (!intentId) continue
    if (!intentOutcomes[intentId]) {
      intentOutcomes[intentId] = { won: 0, lost: 0, totalScore: 0 }
    }
    const outcome = intentOutcomes[intentId]
    if (company.status === "closed_won") {
      outcome.won++
    } else if (company.status === "rejected" || company.status === "closed_lost") {
      outcome.lost++
    }
    outcome.totalScore += (company.relevance_score || 50)
    outcomesProcessed++
  }

  for (const [intentId, stats] of Object.entries(intentOutcomes)) {
    try {
      const total = stats.won + stats.lost
      const conversionRate = total > 0 ? stats.won / total : 0
      const { error } = await supabase
        .from("brand_intents")
        .update({
          conversion_rate: conversionRate,
          last_refined_at: new Date().toISOString(),
        })
        .eq("id", intentId)
        .eq("brand_id", brand.id)
      if (!error) {
        intentsUpdated++
      }
    } catch (err: any) {
      logger.warn({ error: err.message, intentId }, "Failed to update intent performance")
    }
  }

  try {
    const { data: intents } = await supabase
      .from("brand_intents")
      .select("id, conversion_rate, priority")
      .eq("brand_id", brand.id)
      .eq("is_active", true)

    if (intents && intents.length > 0) {
      const sortedIntents = [...intents as any[]].sort((a, b) => {
        const rateDiff = (b.conversion_rate || 0) - (a.conversion_rate || 0)
        if (rateDiff !== 0) return rateDiff > 0 ? 1 : -1
        return (a.priority || 0) - (b.priority || 0)
      })
      for (let index = 0; index < sortedIntents.length; index++) {
        const intent = sortedIntents[index]
        const newPriority = index + 1
        if (intent.priority !== newPriority) {
          await supabase
            .from("brand_intents")
            .update({ priority: newPriority })
            .eq("id", intent.id)
            .eq("brand_id", brand.id)
        }
      }
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, "Failed to re-rank intents")
  }

  try {
    const { data: intents } = await supabase
      .from("brand_intents")
      .select("*")
      .eq("brand_id", brand.id)
      .eq("is_active", true)

    if (intents && intents.length > 0) {
      const syncedCount = await syncAllBrandEmbeddings()
      if (syncedCount > 0) {
        embeddingsSynced = 1
      }
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, "Failed to sync embeddings after feedback")
  }

  return { intentsUpdated, outcomesProcessed, embeddingsSynced }
}
