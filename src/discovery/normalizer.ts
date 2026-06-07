/* =========================================================
   DOMAIN NORMALIZATION
========================================================= */

export function normalizeDomain(input?: string | null): string | null {
  if (!input) return null

  try {
    let domain = input.trim().toLowerCase()

    domain = domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split("?")[0]
      .split("#")[0]

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      return null
    }

    return domain
  } catch {
    return null
  }
}

/* =========================================================
   EMAIL NORMALIZATION
========================================================= */

export function normalizeEmail(input?: string | null): string | null {
  if (!input) return null

  const email = input.trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null
  }

  return email
}
