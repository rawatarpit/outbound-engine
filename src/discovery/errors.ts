/* =========================================================
   FAILURE CLASSIFICATION
========================================================= */

export type FailureType = "retryable" | "fatal"

/* =========================================================
   BASE DISCOVERY ERROR
========================================================= */

export class DiscoveryError extends Error {
  public readonly type: FailureType
  public readonly code?: string
  public readonly metadata?: Record<string, any>

  constructor(
    message: string,
    type: FailureType = "retryable",
    options?: {
      code?: string
      metadata?: Record<string, any>
    }
  ) {
    super(message)

    this.name = "DiscoveryError"
    this.type = type
    this.code = options?.code
    this.metadata = options?.metadata

    Object.setPrototypeOf(this, DiscoveryError.prototype)
  }
}

/* =========================================================
   HELPER: CREATE RETRYABLE ERROR
========================================================= */

export function retryableError(
  message: string,
  metadata?: Record<string, any>
) {
  return new DiscoveryError(message, "retryable", {
    metadata
  })
}

/* =========================================================
   HELPER: CREATE FATAL ERROR
========================================================= */

export function fatalError(
  message: string,
  metadata?: Record<string, any>
) {
  return new DiscoveryError(message, "fatal", {
    metadata
  })
}

/* =========================================================
   TYPE GUARD
========================================================= */

export function isDiscoveryError(
  err: unknown
): err is DiscoveryError {
  return err instanceof DiscoveryError
}

/* =========================================================
   HTTP ERROR CLASSIFIER
========================================================= */

export function classifyHttpStatus(
  status: number
): FailureType {
  // Retryable server-side or rate limit
  if (status === 429) return "retryable"
  if (status >= 500) return "retryable"

  // Auth / permission issues are fatal
  if (status === 401) return "fatal"
  if (status === 403) return "fatal"

  // Client input errors
  if (status >= 400 && status < 500) return "fatal"

  return "retryable"
}

/* =========================================================
   UNKNOWN ERROR CLASSIFIER
========================================================= */

export function classifyUnknownError(
  err: unknown
): FailureType {
  if (err instanceof DiscoveryError) {
    return err.type
  }

  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err
  ) {
    return "retryable"
  }

  return "retryable"
}