import { supabase } from "../db/supabase";
import pino from "pino";
import { DomainReputationConfig } from "../config/reliability";

const logger = pino({ level: "info" });

export interface DomainHealth {
  domain: string;
  bounceRate: number;
  complaintRate: number;
  dailySent: number;
  dailyLimit: number;
  hourlySent: number;
  hourlyLimit: number;
  isHealthy: boolean;
}

export async function checkDomainHealth(
  brandId: string,
  domain: string,
): Promise<DomainHealth> {
  try {
    const { data, error } = await supabase.rpc("get_domain_health", {
      p_brand_id: brandId,
      p_domain: domain,
    });

    if (error || !data) {
      logger.error({ error, domain }, "Failed to get domain health");
      return {
        domain,
        bounceRate: 1,
        complaintRate: 1,
        dailySent: 0,
        dailyLimit: 0,
        hourlySent: 0,
        hourlyLimit: 0,
        isHealthy: false,
      };
    }

    const bounceRate = data.bounce_rate ?? 0;
    const complaintRate = data.complaint_rate ?? 0;
    const dailySent = data.daily_sent ?? 0;
    const dailyLimit = data.daily_limit ?? 0;
    const hourlySent = data.hourly_sent ?? 0;
    const hourlyLimit = data.hourly_limit ?? 0;

    const isHealthy =
      bounceRate < DomainReputationConfig.BOUNCE_RATE_CRITICAL &&
      complaintRate < DomainReputationConfig.BOUNCE_RATE_CRITICAL &&
      dailySent < dailyLimit * DomainReputationConfig.DAILY_SEND_WARNING &&
      hourlySent < hourlyLimit * DomainReputationConfig.HOURLY_SEND_WARNING;

    if (bounceRate > DomainReputationConfig.BOUNCE_RATE_WARNING) {
      logger.warn(
        {
          domain,
          bounceRate,
          threshold: DomainReputationConfig.BOUNCE_RATE_WARNING,
        },
        "Domain bounce rate warning",
      );
    }

    return {
      domain,
      bounceRate,
      complaintRate,
      dailySent,
      dailyLimit,
      hourlySent,
      hourlyLimit,
      isHealthy,
    };
  } catch (err: any) {
    logger.error({ err, domain }, "Domain health check failed");
    return {
      domain,
      bounceRate: 1,
      complaintRate: 1,
      dailySent: 0,
      dailyLimit: 0,
      hourlySent: 0,
      hourlyLimit: 0,
      isHealthy: false,
    };
  }
}

export async function recordBounceAndCheckHealth(
  brandId: string,
  domain: string,
  isHardBounce: boolean,
): Promise<boolean> {
  try {
    await supabase.rpc("register_domain_bounce", {
      p_brand_id: brandId,
      p_domain: domain,
      p_is_hard: isHardBounce,
    });

    const health = await checkDomainHealth(brandId, domain);

    if (!health.isHealthy && isHardBounce) {
      await disableDomain(brandId, domain, "bounce_rate_exceeded");
      return false;
    }

    return health.isHealthy;
  } catch (err: any) {
    logger.error({ err, domain }, "Failed to record bounce");
    return false;
  }
}

async function disableDomain(
  brandId: string,
  domain: string,
  reason: string,
): Promise<void> {
  try {
    await supabase
      .from("sending_domains")
      .update({
        is_active: false,
        disabled_reason: reason,
        disabled_at: new Date().toISOString(),
      })
      .eq("brand_id", brandId)
      .eq("domain", domain);

    logger.warn(
      { brandId, domain, reason },
      "Domain disabled due to reputation",
    );
  } catch (err: any) {
    logger.error({ err, domain }, "Failed to disable domain");
  }
}

export async function reserveQuota(
  brandId: string,
  domain: string,
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const { data, error } = await supabase.rpc("reserve_send_quota", {
      p_brand_id: brandId,
      p_domain: domain,
    });

    if (error || !data) {
      return { allowed: false, reason: "quota_reservation_failed" };
    }

    if (data === true) {
      return { allowed: true };
    }

    const health = await checkDomainHealth(brandId, domain);

    if (health.dailySent >= health.dailyLimit) {
      return { allowed: false, reason: "daily_limit_exceeded" };
    }

    if (health.hourlySent >= health.hourlyLimit) {
      return { allowed: false, reason: "hourly_limit_exceeded" };
    }

    return { allowed: false, reason: "quota_unavailable" };
  } catch (err: any) {
    logger.error({ err, domain }, "Quota reservation failed");
    return { allowed: false, reason: "quota_reservation_error" };
  }
}
