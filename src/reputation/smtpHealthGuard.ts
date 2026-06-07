const transporterFailures = new Map<string, number>()
const transporterResetWindow = new Map<string, number>()

const WINDOW_MS = 5 * 60 * 1000
const FAILURE_LIMIT = 3

export function recordTransportFailure(brandId: string) {
  const now = Date.now()
  const windowStart = transporterResetWindow.get(brandId) || now

  if (now - windowStart > WINDOW_MS) {
    transporterFailures.set(brandId, 1)
    transporterResetWindow.set(brandId, now)
    return
  }

  const count = (transporterFailures.get(brandId) || 0) + 1
  transporterFailures.set(brandId, count)
}

export function isTransportUnstable(brandId: string): boolean {
  const failures = transporterFailures.get(brandId) || 0
  return failures >= FAILURE_LIMIT
}
