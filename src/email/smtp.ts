import nodemailer from "nodemailer"
import pino from "pino"
import { supabase } from "../db/supabase"

const logger = pino({ level: "info" })

/* =========================================================
   TRANSPORT POOL (PER BRAND)
========================================================= */

const transportPool = new Map<string, nodemailer.Transporter>()
const senderMap = new Map<string, string>()
const transportTTL = new Map<string, number>()
const TRANSPORT_TTL_MS = 30 * 60 * 1000 // 30 minutes

/* =========================================================
   BRAND CREDENTIALS (brand_id based)
   Matches: get_brand_credentials(p_brand_id uuid)
========================================================= */

interface BrandCredentials {
  brand_id: string
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  smtp_email: string
  smtp_password: string
}

async function getBrandCredentials(
  brandId: string
): Promise<BrandCredentials> {
  const { data, error } = await supabase.rpc(
    "get_brand_credentials",
    { p_brand_id: brandId }
  )

  if (error || !data) {
    throw new Error(`Missing credentials for brand ${brandId}`)
  }

  // Supabase RPC returning TABLE → array
  const creds = Array.isArray(data) ? data[0] : data

  if (!creds?.smtp_host || !creds?.smtp_email) {
    throw new Error(`Incomplete SMTP config for brand ${brandId}`)
  }

  return creds as BrandCredentials
}

/* =========================================================
   GET / CREATE TRANSPORT (POOLED)
========================================================= */

async function getTransport(
  brandId: string
): Promise<nodemailer.Transporter> {
  if (transportPool.has(brandId) && Date.now() < (transportTTL.get(brandId) ?? 0)) {
    return transportPool.get(brandId)!
  }

  transportPool.delete(brandId)
  senderMap.delete(brandId)

  const creds = await getBrandCredentials(brandId)

  const transporter = nodemailer.createTransport({
    host: creds.smtp_host,
    port: creds.smtp_port,
    secure: creds.smtp_secure,
    auth: {
      user: creds.smtp_email,
      pass: creds.smtp_password
    },
    pool: true,
    maxConnections: 3,
    maxMessages: 100
  })

  transportPool.set(brandId, transporter)
  senderMap.set(brandId, creds.smtp_email)
  transportTTL.set(brandId, Date.now() + TRANSPORT_TTL_MS)

  logger.info(`SMTP transport created → ${brandId}`)

  return transporter
}

/* =========================================================
   SEND EMAIL
========================================================= */

export async function sendEmail(
  brandId: string,
  to: string,
  subject: string,
  body: string,
  deterministicMessageId?: string,
  brandName?: string,
  threadMeta?: { companyId?: string; leadId?: string }
): Promise<string> {
  const transporter = await getTransport(brandId)
  const senderEmail = senderMap.get(brandId)

  if (!senderEmail) {
    throw new Error(`Missing sender email for brand ${brandId}`)
  }

  const bodyWithMeta = threadMeta
    ? `${body}\n\n\n--\ncompany_id:${threadMeta.companyId}\nlead_id:${threadMeta.leadId}`
    : body

  try {
    const displayName = brandName || brandId
    const mailOptions: nodemailer.SendMailOptions = {
      from: `"${displayName}" <${senderEmail}>`,
      to,
      subject,
      text: bodyWithMeta
    }

    // Optional deterministic Message-ID injection
    if (deterministicMessageId) {
      mailOptions.messageId = `<${deterministicMessageId}@${senderEmail.split("@")[1]}>`
    }

    const info = await transporter.sendMail(mailOptions)

    /* =====================================
       DOMAIN METRIC UPDATE
       Matches: rpc_increment_domain_metric(p_product text, p_metric text)
    ====================================== */

    const { error: sentError } = await supabase.rpc("rpc_increment_domain_metric", {
      p_product: brandId,
      p_metric: "sent"
    })

    if (sentError) {
      logger.error(
        { brandId, error: sentError.message },
        "Failed to increment domain metric (sent)"
      )
    }

    logger.info(
      `Email sent → ${brandId} → ${info.messageId}`
    )

    return info.messageId

  } catch (err: any) {
    logger.error(
      { err, brandId },
      "SMTP send error"
    )

    /* =====================================
       HARD BOUNCE DETECTION
    ====================================== */

    if (err.response?.includes("550")) {
      await supabase.rpc("rpc_increment_domain_metric", {
        p_product: brandId,
        p_metric: "bounce"
      })
    }

    // Reset pooled transport on failure
    transportPool.delete(brandId)
    senderMap.delete(brandId)

    throw err
  }
}

/* =========================================================
   SHUTDOWN CLEANUP (OPTIONAL)
========================================================= */

export async function closeSMTPPools() {
  for (const [brandId, transporter] of transportPool.entries()) {
    try {
      transporter.close()
      logger.info(`SMTP pool closed → ${brandId}`)
    } catch (err) {
      logger.error({ err }, `Failed closing SMTP pool → ${brandId}`)
    }
  }

  transportPool.clear()
  senderMap.clear()
}
