import { EnrichedData } from "../types"

export function validateEnrichedData(data: EnrichedData) {
  if (!data) return { valid: false }

  if (data.email && !data.email.includes("@")) {
    return { valid: false }
  }

  if (data.confidence < 0 || data.confidence > 1) {
    return { valid: false }
  }

  return { valid: true }
}
