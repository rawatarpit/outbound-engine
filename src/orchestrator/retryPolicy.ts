import { supabase } from "../db/supabase";
import pino from "pino";
import { RetryConfig } from "../config/reliability";

const logger = pino({ level: "info" });

export interface RetryDecision {
  shouldRetry: boolean;
  shouldDeadLetter: boolean;
  reason: string;
  nextRetryAt?: Date;
}

export async function evaluateRetryPolicy(
  entityType: "company" | "lead",
  entityId: string,
): Promise<RetryDecision> {
  try {
    const table = entityType === "company" ? "companies" : "leads";
    const retryColumn =
      entityType === "company" ? "retry_count" : "retry_count";
    const attemptsColumn =
      entityType === "company" ? "enrichment_attempts" : "enrichment_attempts";

    const { data, error } = await supabase
      .from(table)
      .select(`${retryColumn}, ${attemptsColumn}, last_error`)
      .eq("id", entityId)
      .maybeSingle();

    if (error || !data) {
      logger.error({ error, entityId }, "Failed to fetch retry state");
      return {
        shouldRetry: false,
        shouldDeadLetter: true,
        reason: "entity_not_found",
      };
    }

    const retryCount = data[retryColumn] ?? 0;
    const enrichAttempts = data[attemptsColumn] ?? 0;
    const lastError = data.last_error;

    if (retryCount >= RetryConfig.MAX_RETRY) {
      logger.warn({ entityId, retryCount }, "Max retries exceeded");
      return {
        shouldRetry: false,
        shouldDeadLetter: true,
        reason: RetryConfig.DEAD_LETTER_REASON_MAX_RETRIES,
      };
    }

    if (enrichAttempts >= RetryConfig.MAX_ENRICH_ATTEMPTS) {
      logger.warn(
        { entityId, enrichAttempts },
        "Max enrichment attempts exceeded",
      );
      return {
        shouldRetry: false,
        shouldDeadLetter: true,
        reason: RetryConfig.DEAD_LETTER_REASON_MAX_ENRICH,
      };
    }

    const backoffMs = Math.min(
      RetryConfig.RETRY_BACKOFF_BASE_MS * Math.pow(2, retryCount),
      RetryConfig.MAX_BACKOFF_MS,
    );

    const nextRetryAt = new Date(Date.now() + backoffMs);

    return {
      shouldRetry: true,
      shouldDeadLetter: false,
      reason: "retryable_error",
      nextRetryAt,
    };
  } catch (err: any) {
    logger.error({ err, entityId }, "Retry policy evaluation failed");
    return {
      shouldRetry: false,
      shouldDeadLetter: true,
      reason: "policy_evaluation_error",
    };
  }
}

export async function moveToDeadLetter(
  entityType: "company" | "lead",
  entityId: string,
  reason: string,
): Promise<void> {
  try {
    const table = entityType === "company" ? "companies" : "leads";
    const statusColumn = entityType === "company" ? "status" : "status";

    const { error: updateError } = await supabase
      .from(table)
      .update({
        [statusColumn]: "dead_letter",
        last_error: reason,
      })
      .eq("id", entityId);

    if (updateError) {
      logger.error(
        { entityId, entityType, error: updateError.message },
        "Failed to update entity to dead letter"
      );
    }

    const { error: insertError } = await supabase.from("dead_letters").insert({
      entity_type: entityType,
      entity_id: entityId,
      reason,
      failed_at: new Date().toISOString(),
    });

    if (insertError) {
      logger.error(
        { entityId, entityType, error: insertError.message },
        "Failed to insert dead letter record"
      );
    }

    logger.info({ entityId, entityType, reason }, "Moved to dead letter");
  } catch (err: any) {
    logger.error({ err, entityId }, "Failed to move to dead letter");
  }
}

export async function incrementRetryCount(
  entityType: "company" | "lead",
  entityId: string,
  errorMessage: string,
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("rpc_register_failure", {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_error: errorMessage.slice(0, 500),
    });

    if (error) {
      logger.error({ error, entityId }, "Failed to increment retry count");
      return -1;
    }

    return data ? 1 : -1;
  } catch (err: any) {
    logger.error({ err, entityId }, "Retry count increment failed");
    return -1;
  }
}
