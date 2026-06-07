import { supabase } from "../db/supabase";
import pino from "pino";
import { CircuitBreakerConfig } from "../config/reliability";

const logger = pino({ level: "info" });

interface SourceFailure {
  sourceId: string;
  failures: number;
  successes: number;
  lastFailureAt: number;
  cooldownUntil?: number;
}

const sourceStats = new Map<string, SourceFailure>();

function getOrCreateSource(sourceId: string): SourceFailure {
  let stats = sourceStats.get(sourceId);
  if (!stats) {
    stats = {
      sourceId,
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
    };
    sourceStats.set(sourceId, stats);
  }
  return stats;
}

export function recordSourceSuccess(sourceId: string): void {
  const stats = getOrCreateSource(sourceId);
  stats.successes++;
  stats.lastFailureAt = Date.now();
}

export function recordSourceFailure(sourceId: string): void {
  const stats = getOrCreateSource(sourceId);
  stats.failures++;
  stats.lastFailureAt = Date.now();
}

export function isSourceAvailable(sourceId: string): boolean {
  const stats = sourceStats.get(sourceId);

  if (!stats) return true;

  if (stats.cooldownUntil && Date.now() < stats.cooldownUntil) {
    return false;
  }

  const total = stats.failures + stats.successes;
  if (total < CircuitBreakerConfig.MIN_SAMPLES) return true;

  const failureRate = stats.failures / total;

  if (failureRate > CircuitBreakerConfig.FAILURE_RATE_THRESHOLD) {
    stats.cooldownUntil = Date.now() + CircuitBreakerConfig.COOLDOWN_MS;
    logger.warn(
      { sourceId, failureRate, total },
      "Source circuit breaker opened",
    );
    return false;
  }

  return true;
}

export function getSourceFailureRate(sourceId: string): number {
  const stats = sourceStats.get(sourceId);
  if (!stats) return 0;

  const total = stats.failures + stats.successes;
  if (total < CircuitBreakerConfig.MIN_SAMPLES) return 0;

  return stats.failures / total;
}

export async function disableSource(
  sourceId: string,
  reason: string,
): Promise<void> {
  try {
    await supabase
      .from("discovery_sources")
      .update({ is_active: false, last_error: reason })
      .eq("id", sourceId);

    const stats = sourceStats.get(sourceId);
    if (stats) {
      stats.cooldownUntil = Date.now() + CircuitBreakerConfig.COOLDOWN_MS;
    }

    logger.warn({ sourceId, reason }, "Source disabled due to failures");
  } catch (err: any) {
    logger.error({ err, sourceId }, "Failed to disable source");
  }
}

export function resetSourceStats(sourceId: string): void {
  sourceStats.delete(sourceId);
}
