import { EnrichedData } from "../types"
import { isGenericEmail } from "./email-validator"

export function validateEnrichedData(data: EnrichedData) {
  if (!data) return { valid: false }

  if (data.email && !data.email.includes("@")) {
    return { valid: false }
  }

  if (data.email && isGenericEmail(data.email)) {
    return { valid: false, reason: "generic_email" }
  }

  if (data.confidence < 0 || data.confidence > 1) {
    return { valid: false }
  }

  return { valid: true }
}
