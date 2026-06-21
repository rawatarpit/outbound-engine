import net from "net"
import dns from "dns"
import { promisify } from "util"
import {
  EnrichmentStrategyExecutor,
  EnrichmentStatus,
  EnrichmentStrategyType,
  EnrichmentContext,
  ClaimedContact,
  ClaimedCompany,
} from "../types"

const resolveMxAsync = promisify(dns.resolveMx)

function smtpVerifyEmail(
  email: string,
  mxHost: string,
  timeout = 8000
): Promise<{ verified: boolean; code: number; message: string }> {
  return new Promise((resolve) => {
    const [local, domain] = email.split("@")
    if (!local || !domain) {
      return resolve({ verified: false, code: 0, message: "Invalid email format" })
    }

    const socket = new net.Socket()
    let responseCode = 0
    let responseMessage = ""
    let step = 0
    let resolved = false

    const done = (verified: boolean, code: number, msg: string) => {
      if (resolved) return
      resolved = true
      socket.end()
      socket.destroy()
      resolve({ verified, code, message: msg })
    }

    const send = (cmd: string) => {
      socket.write(cmd + "\r\n")
    }

    socket.setTimeout(timeout)
    socket.connect(25, mxHost, () => {
      step = 1
    })

    socket.on("data", (data) => {
      const text = data.toString()
      const match = text.match(/^(\d{3})/)
      if (match) {
        responseCode = parseInt(match[1])
        responseMessage = text.trim()
      }

      if (step === 1) {
        step = 2
        send(`HELO bricks.local`)
      } else if (step === 2) {
        step = 3
        send(`MAIL FROM:<verify@${domain}>`)
      } else if (step === 3) {
        step = 4
        send(`RCPT TO:<${email}>`)
      } else if (step === 4) {
        done(responseCode === 250, responseCode, responseMessage)
      }
    })

    socket.on("error", (err) => {
      done(false, 0, `Connection error: ${err.message}`)
    })

    socket.on("timeout", () => {
      done(false, 0, "Timeout")
    })

    socket.on("close", () => {
      if (!resolved) done(false, 0, "Connection closed")
    })
  })
}

export const smtpVerificationExecutor: EnrichmentStrategyExecutor = {
  async execute(context: EnrichmentContext) {
    const { type, entity } = context

    let email: string | undefined
    let domain: string | undefined

    if (type === "contact") {
      const contact = entity as ClaimedContact
      email = contact.email || undefined
      domain = contact.domain
    } else if (type === "company") {
      const company = entity as ClaimedCompany
      domain = company.domain || undefined
      return { status: EnrichmentStatus.PARTIAL, data: { confidence: 0, strategy: EnrichmentStrategyType.SMTP_VERIFICATION } }
    }

    if (!email || !domain) {
      return { status: EnrichmentStatus.FAILED, error: "Missing email or domain" }
    }

    try {
      const mxRecords = await resolveMxAsync(domain)

      if (!mxRecords || mxRecords.length === 0) {
        return {
          status: EnrichmentStatus.PARTIAL,
          data: {
            email_verified: false,
            confidence: 0.15,
            strategy: EnrichmentStrategyType.SMTP_VERIFICATION,
            raw: { reason: "No MX records found for domain" },
          },
        }
      }

      const primaryMx = mxRecords.sort((a, b) => a.priority - b.priority)[0]
      const result = await smtpVerifyEmail(email, primaryMx.exchange)

      if (result.verified) {
        return {
          status: EnrichmentStatus.SUCCESS,
          data: {
            email_verified: true,
            confidence: 0.9,
            strategy: EnrichmentStrategyType.SMTP_VERIFICATION,
            raw: { mx_host: primaryMx.exchange, code: result.code, message: result.message },
          },
        }
      }

      return {
        status: EnrichmentStatus.PARTIAL,
        data: {
          email_verified: false,
          confidence: 0.25,
          strategy: EnrichmentStrategyType.SMTP_VERIFICATION,
          raw: { mx_host: primaryMx.exchange, code: result.code, message: result.message },
        },
      }
    } catch (err: any) {
      return {
        status: EnrichmentStatus.FAILED,
        error: `SMTP verification error: ${err.message}`,
      }
    }
  },
}
