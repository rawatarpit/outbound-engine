import {
  EnrichmentStrategyExecutor,
  EnrichmentStatus,
  EnrichmentStrategyType,
  EnrichmentContext,
  ClaimedContact,
} from "../types";

import { normalizeEmail } from "../../discovery/normalizer";

function generatePatterns(
  first: string,
  last: string,
  domain: string,
): string[] {
  const patterns: string[] = [
    `${first}.${last}@${domain}`,
    `${first}${last}@${domain}`,
  ];

  if (first.length > 0) {
    patterns.push(`${first[0]}${last}@${domain}`);
    patterns.push(`${first}@${domain}`);
  }

  if (last.length > 0 && first.length > 0) {
    patterns.push(`${first}.${last[0]}@${domain}`);
  }

  return patterns
    .map(normalizeEmail)
    .filter((e): e is string => typeof e === "string");
}

export const emailPatternExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext) {
    if (context.type !== "contact") {
      return { status: EnrichmentStatus.FAILED };
    }

    const contact = context.entity as ClaimedContact;

    if (!contact.first_name || !contact.last_name || !contact.domain) {
      return { status: EnrichmentStatus.FAILED };
    }

    const candidates = generatePatterns(
      contact.first_name.toLowerCase(),
      contact.last_name.toLowerCase(),
      contact.domain.toLowerCase(),
    );

    if (!candidates.length) {
      return { status: EnrichmentStatus.FAILED };
    }

    return {
      status: EnrichmentStatus.PARTIAL,
      data: {
        email: candidates[0],
        email_verified: false,
        confidence: 0.4,
        strategy: EnrichmentStrategyType.EMAIL_PATTERN,
      },
    };
  },
};
