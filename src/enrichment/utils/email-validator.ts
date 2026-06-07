import dns from "dns"

const GENERIC_EMAIL_PREFIXES = [
  "contact",
  "info",
  "support",
  "hello",
  "admin",
  "sales",
  "help",
  "noreply",
  "no-reply",
  "notifications",
  "billing",
  "office",
  "enquiries",
  "enquiries",
  "team",
  "staff",
  "jobs",
  "careers",
  "hr",
  "marketing",
  "press",
  "media",
  "webmaster",
  "postmaster",
  "abuse",
  "mail",
  "email",
  "feedback",
  "inquiries",
  "reception",
  "frontdesk",
  "general",
  "service",
  "customer",
  "customerservice",
]

function domainHasMX(domain: string): Promise<boolean> {
  return new Promise((resolve) => {
    dns.resolveMx(domain, (err, mxRecords) => {
      resolve(!err && mxRecords && mxRecords.length > 0)
    })
  })
}

function domainExists(domain: string): Promise<boolean> {
  return new Promise((resolve) => {
    dns.resolveAny(domain, (err) => resolve(!err))
  })
}

export async function isDeliverableDomain(domain: string): Promise<boolean> {
  if (!domain || domain === "unknown.com" || domain === "unknown" || domain === "null" || domain === "undefined") {
    return false
  }
  return domainExists(domain)
}

export function isGenericEmail(email: string): boolean {
  if (!email || !email.includes("@")) return true

  const prefix = email.split("@")[0].toLowerCase().trim()

  return GENERIC_EMAIL_PREFIXES.some(
    (generic) => prefix === generic || prefix.startsWith(generic + ".") || prefix.startsWith(generic + "+")
  )
}

export function isValidPersonalEmail(email: string): boolean {
  if (!email) return false

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) return false

  if (isGenericEmail(email)) return false

  return true
}

export function getDomainFromEmail(email: string): string | null {
  if (!email || !email.includes("@")) return null
  return email.split("@")[1].toLowerCase()
}
