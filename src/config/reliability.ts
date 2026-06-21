export const RetryConfig = {
  MAX_RETRY: 3,
  MAX_ENRICH_ATTEMPTS: 3,
  RETRY_BACKOFF_BASE_MS: 60_000,
  MAX_BACKOFF_MS: 15 * 60 * 1000,
  DEAD_LETTER_REASON_MAX_RETRIES: "max_retries_exceeded",
  DEAD_LETTER_REASON_MAX_ENRICH: "max_enrich_attempts_exceeded",
} as const;

export const CircuitBreakerConfig = {
  FAILURE_RATE_THRESHOLD: 0.4,
  MIN_SAMPLES: 5,
  COOLDOWN_MS: 5 * 60 * 1000,
} as const;

export const DomainReputationConfig = {
  BOUNCE_RATE_WARNING: 0.03,
  BOUNCE_RATE_CRITICAL: 0.05,
  HOURLY_SEND_WARNING: 0.8,
  DAILY_SEND_WARNING: 0.9,
} as const;

export const OrchestratorConfig = {
  MAX_PLAN_STEPS: 20,
  PARALLEL_BATCH_SIZE: 5,
  CACHE_TTL_MS: 5 * 60 * 1000,
  MAX_LEADS_PER_QUERY: 10,
  SESSION_TTL_MS: 60 * 60 * 1000,
  MAX_ITERATIONS: 15,
} as const;
