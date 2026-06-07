import pino from "pino";

const logger = pino({ level: "info" });

interface BrandProfile {
  id: string;
  sent_count: number | null;
  bounce_count: number | null;
  complaint_count: number | null;
  is_paused: boolean | null;
  send_enabled: boolean | null;
}

/**
 * Runtime-only reputation guard.
 * NO DB writes.
 * NO schema changes.
 *
 * Applies graduated protection from first send with scaled thresholds.
 */
export function isBrandReputationSafe(brand: BrandProfile | null): boolean {
  if (!brand) return false;

  if (brand.is_paused) {
    logger.warn("Brand paused → blocking sends");
    return false;
  }

  if (brand.send_enabled === false) {
    logger.warn("Send disabled → blocking sends");
    return false;
  }

  const sent = brand.sent_count ?? 0;
  const bounces = brand.bounce_count ?? 0;
  const complaints = brand.complaint_count ?? 0;

  if (sent === 0) {
    return true;
  }

  const bounceRate = bounces / Math.max(sent, 1);
  const complaintRate = complaints / Math.max(sent, 1);

  const bounceThreshold = getBounceThreshold(sent);
  const complaintThreshold = getComplaintThreshold(sent);

  if (bounceRate > bounceThreshold) {
    logger.error(
      { bounceRate, threshold: bounceThreshold, sent },
      "Bounce rate exceeded threshold → blocking brand",
    );
    return false;
  }

  if (complaintRate > complaintThreshold) {
    logger.error(
      { complaintRate, threshold: complaintThreshold, sent },
      "Complaint rate exceeded threshold → blocking brand",
    );
    return false;
  }

  return true;
}

function getBounceThreshold(sent: number): number {
  if (sent < 10) return 0.02;
  if (sent < 20) return 0.035;
  return 0.05;
}

function getComplaintThreshold(sent: number): number {
  if (sent < 10) return 0.001;
  if (sent < 20) return 0.002;
  return 0.003;
}

/**
 * Optional helper for logging health metrics.
 * Purely informational.
 */
export function computeBrandHealthSnapshot(brand: BrandProfile | null) {
  if (!brand) return null;

  const sent = brand.sent_count ?? 0;
  const bounces = brand.bounce_count ?? 0;
  const complaints = brand.complaint_count ?? 0;

  return {
    sent,
    bounces,
    complaints,
    bounceRate: sent ? bounces / sent : 0,
    complaintRate: sent ? complaints / sent : 0,
    paused: brand.is_paused ?? false,
    sendEnabled: brand.send_enabled ?? false,
  };
}
