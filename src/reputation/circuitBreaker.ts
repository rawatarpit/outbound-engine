import { supabase } from "../db/supabase";
import pino from "pino";

const logger = pino({ level: "info" });

type BreakerState = "closed" | "open" | "half-open";

interface BrandBreaker {
  failures: number;
  lastFailureAt: number;
  state: BreakerState;
  cooldownUntil?: number;
}

const breakers = new Map<string, BrandBreaker>();

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 7 * 60 * 1000; // 7 minutes

export async function loadBreakerState() {
  try {
    const { data, error } = await supabase
      .from("circuit_breaker_state")
      .select("*");

    if (error) {
      logger.error({ error }, "Failed to load circuit breaker state");
      return;
    }

    if (!data) return;

    for (const row of data) {
      if (row.state === "open" && row.cooldown_until) {
        if (Date.now() > row.cooldown_until) {
          breakers.set(row.brand_id, {
            failures: row.failures,
            lastFailureAt: new Date(row.last_failure_at).getTime(),
            state: "half-open",
            cooldownUntil: row.cooldown_until,
          });
        } else {
          breakers.set(row.brand_id, {
            failures: row.failures,
            lastFailureAt: new Date(row.last_failure_at).getTime(),
            state: "open",
            cooldownUntil: row.cooldown_until,
          });
        }
      } else {
        breakers.set(row.brand_id, {
          failures: row.failures,
          lastFailureAt: new Date(row.last_failure_at).getTime(),
          state: row.state,
        });
      }
    }

    logger.info({ count: breakers.size }, "Circuit breaker state loaded");
  } catch (err: any) {
    logger.error({ err }, "Error loading circuit breaker state");
  }
}

async function saveBreakerState(brandId: string, breaker: BrandBreaker) {
  const { error } = await supabase.from("circuit_breaker_state").upsert(
    {
      brand_id: brandId,
      failures: breaker.failures,
      last_failure_at: new Date(breaker.lastFailureAt).toISOString(),
      state: breaker.state,
      cooldown_until: breaker.cooldownUntil || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "brand_id" },
  );

  if (error) {
    logger.error({ brandId, error: error.message }, "Failed to persist circuit breaker state");
  }
}

export function canSend(brandId: string): boolean {
  const breaker = breakers.get(brandId);
  if (!breaker) return true;

  if (breaker.state === "open") {
    if (Date.now() > (breaker.cooldownUntil || 0)) {
      breaker.state = "half-open";
      saveBreakerState(brandId, breaker);
      return true;
    }
    return false;
  }

  return true;
}

export function recordSuccess(brandId: string) {
  breakers.set(brandId, {
    failures: 0,
    lastFailureAt: Date.now(),
    state: "closed",
  });
  saveBreakerState(brandId, breakers.get(brandId)!);
}

export function recordFailure(brandId: string) {
  const current = breakers.get(brandId);

  if (!current) {
    breakers.set(brandId, {
      failures: 1,
      lastFailureAt: Date.now(),
      state: "closed",
    });
    saveBreakerState(brandId, breakers.get(brandId)!);
    return;
  }

  const failures = current.failures + 1;

  if (failures >= FAILURE_THRESHOLD) {
    const newBreaker: BrandBreaker = {
      failures,
      lastFailureAt: Date.now(),
      state: "open",
      cooldownUntil: Date.now() + COOLDOWN_MS,
    };
    breakers.set(brandId, newBreaker);
    saveBreakerState(brandId, newBreaker);
  } else {
    const updated = {
      ...current,
      failures,
      lastFailureAt: Date.now(),
    };
    breakers.set(brandId, updated);
    saveBreakerState(brandId, updated);
  }
}
