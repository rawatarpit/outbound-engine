export type BounceResult =
  | "hard"
  | "soft"
  | "none"

/**
 * Enhanced SMTP bounce classifier.
 * Designed for:
 * - Gmail
 * - Outlook
 * - SES
 * - Postfix
 * - Exim
 * - Generic MTAs
 *
 * Safe defaults:
 * - 5xx → hard
 * - 4xx → soft
 * - Unknown → none
 */
export function classifyBounce(raw: string): BounceResult {
  if (!raw) return "none"

  const lower = raw.toLowerCase()

  /* =========================
     ENHANCED STATUS CODES
     ========================= */

  // RFC 3463 Enhanced codes
  if (lower.match(/\b5\.\d\.\d\b/)) return "hard"
  if (lower.match(/\b4\.\d\.\d\b/)) return "soft"

  /* =========================
     SMTP STATUS CODES
     ========================= */

  // 5xx = permanent failure
  if (lower.match(/\b5\d\d\b/)) return "hard"

  // 4xx = temporary failure
  if (lower.match(/\b4\d\d\b/)) return "soft"

  /* =========================
     HARD BOUNCE STRINGS
     ========================= */

  const hardIndicators = [
    "user unknown",
    "no such user",
    "recipient address rejected",
    "mailbox unavailable",
    "invalid recipient",
    "address does not exist",
    "unknown recipient",
    "unrouteable address",
    "domain not found",
    "host not found",
    "relay access denied",
    "account disabled",
    "5.1.1",
    "5.2.1",
    "5.4.1"
  ]

  for (const indicator of hardIndicators) {
    if (lower.includes(indicator)) {
      return "hard"
    }
  }

  /* =========================
     SOFT BOUNCE STRINGS
     ========================= */

  const softIndicators = [
    "mailbox full",
    "temporarily deferred",
    "try again later",
    "greylisted",
    "rate limited",
    "connection timed out",
    "resources temporarily unavailable",
    "server busy",
    "quota exceeded",
    "4.2.2",
    "4.4.1",
    "4.5.3"
  ]

  for (const indicator of softIndicators) {
    if (lower.includes(indicator)) {
      return "soft"
    }
  }

  /* =========================
     PROVIDER-SPECIFIC PATTERNS
     ========================= */

  // Gmail
  if (lower.includes("gmail.com") && lower.includes("550-5.1.1")) {
    return "hard"
  }

  // Outlook / Microsoft
  if (lower.includes("outlook") && lower.includes("550 5.1.10")) {
    return "hard"
  }

  // Amazon SES structured feedback
  if (lower.includes("permanent failure")) {
    return "hard"
  }

  if (lower.includes("temporary failure")) {
    return "soft"
  }

  /* =========================
     FALLBACK
     ========================= */

  return "none"
}
