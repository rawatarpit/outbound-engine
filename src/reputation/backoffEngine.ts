const brandBackoff = new Map<string, number>()

export function getBackoffDelay(brandId: string): number {
  const failures = brandBackoff.get(brandId) || 0

  if (failures === 0) return randomJitter(200, 800)

  const delay = Math.min(60000, failures * 15000)
  return delay + randomJitter(100, 500)
}

export function recordSoftFailure(brandId: string) {
  const current = brandBackoff.get(brandId) || 0
  brandBackoff.set(brandId, current + 1)
}

export function resetBackoff(brandId: string) {
  brandBackoff.set(brandId, 0)
}

function randomJitter(min: number, max: number) {
  return Math.floor(Math.random() * (max - min) + min)
}
