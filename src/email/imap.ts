import { ImapFlow, FetchMessageObject } from "imapflow";
import pino from "pino";
import {
  registerBounce,
  insertReply,
  getActiveImapBrands,
} from "../db/supabase";
import { runReplyAnalysis } from "../agents/replyAnalysis";
import { supabase } from "../db/supabase";

const logger = pino({ level: "info" });

let shuttingDown = false;
const activeClients: Map<string, ImapFlow> = new Map();

/* =======================================================
   CLAIM MESSAGE (BRAND-SCOPED + DISTRIBUTED SAFE)
======================================================= */

async function claimInboundMessage(
  messageId: string,
  brandId: string,
): Promise<boolean> {
  if (!messageId || !brandId) {
    logger.error("Missing messageId or brandId during claim");
    return false;
  }

  const { data, error } = await supabase.rpc("rpc_claim_inbound_message", {
    p_message_id: messageId,
    p_brand_id: brandId,
  });

  if (error) {
    logger.error({ error }, "Message claim failed");
    return false;
  }

  return data === true;
}

/* =======================================================
   CLASSIFICATION
======================================================= */

type EmailEventType =
  | "reply"
  | "bounce_hard"
  | "bounce_soft"
  | "ooo"
  | "complaint";

function classifyEmail(raw: string): EmailEventType {
  const lower = raw.toLowerCase();

  if (lower.includes("550 5.1.1") || lower.includes("user unknown"))
    return "bounce_hard";

  if (lower.includes("mailbox full") || lower.includes("421"))
    return "bounce_soft";

  if (lower.includes("out of office") || lower.includes("auto reply"))
    return "ooo";

  if (lower.includes("spam complaint")) return "complaint";

  return "reply";
}

/* =======================================================
   DOMAIN EXTRACTION
======================================================= */

function extractRecipientDomain(raw: string): string | null {
  const match = raw.match(/To:\s.*?<(.*?)>/i);
  if (!match) return null;

  const email = match[1].toLowerCase();
  const parts = email.split("@");

  return parts.length === 2 ? parts[1] : null;
}

/* =======================================================
   THREAD CONTEXT EXTRACTION
======================================================= */

function extractCompanyFromThread(raw: string): string | null {
  const match = raw.match(/company_id:(.*?)\n/);
  return match ? match[1].trim() : null;
}

function extractLeadFromThread(raw: string): string | null {
  const match = raw.match(/lead_id:(.*?)\n/);
  return match ? match[1].trim() : null;
}

/* =======================================================
   HANDLE MESSAGE
======================================================= */

async function handleMessage(
  client: ImapFlow,
  msg: FetchMessageObject,
  brand: any,
) {
  if (!msg.source || !msg.envelope) return;

  const raw = msg.source.toString();
  const messageId = msg.envelope.messageId ?? "";
  if (!messageId) return;

  const claimed = await claimInboundMessage(messageId, brand.id);
  if (!claimed) return;

  const companyId = extractCompanyFromThread(raw);
  const leadId = extractLeadFromThread(raw);

  if (!companyId || !leadId) {
    logger.warn("Inbound message missing thread metadata");
    await client.messageFlagsAdd(msg.uid, ["\\Seen"]);
    return;
  }

  const type = classifyEmail(raw);

  if (type === "bounce_hard" || type === "complaint") {
    const domain = extractRecipientDomain(raw);
    if (domain) await registerBounce(brand.id, domain);

    await supabase
      .from("companies")
      .update({
        status: "closed_lost",
        updated_at: new Date(),
      })
      .eq("id", companyId)
      .eq("brand_id", brand.id);

    await client.messageFlagsAdd(msg.uid, ["\\Seen"]);
    return;
  }

  if (type === "bounce_soft") {
    const domain = extractRecipientDomain(raw);
    if (domain) await registerBounce(brand.id, domain);

    await supabase
      .from("companies")
      .update({
        status: "draft_ready",
        updated_at: new Date(),
      })
      .eq("id", companyId)
      .eq("brand_id", brand.id);

    await client.messageFlagsAdd(msg.uid, ["\\Seen"]);
    return;
  }

  if (type === "ooo") {
    await client.messageFlagsAdd(msg.uid, ["\\Seen"]);
    return;
  }

  await runReplyAnalysis(companyId, messageId, raw);

  await insertReply(
    companyId,
    leadId,
    messageId,
    raw,
    msg.envelope.subject ?? "",
  );

  await client.messageFlagsAdd(msg.uid, ["\\Seen"]);

  logger.info(`Reply processed → ${companyId}`);
}

/* =======================================================
   MONITOR LOOP (MAILBOX MODE ONLY)
======================================================= */

async function monitorBrand(brand: any) {
  // Skip API transport brands
  if (brand.transport_mode === "api") {
    logger.info(`Skipping IMAP for API transport brand → ${brand.id}`);
    return;
  }

  let backoff = 5000;

  while (!shuttingDown) {
    try {
      const client = new ImapFlow({
        host: brand.imap_host,
        port: brand.imap_port,
        secure: brand.imap_secure,
        auth: {
          user: brand.imap_email,
          pass: brand.imap_password,
        },
      });

      await client.connect();
      await client.mailboxOpen("INBOX");

      activeClients.set(brand.id, client);
      logger.info(`📬 IMAP started → ${brand.id}`);

      backoff = 5000;

      while (!shuttingDown && client.usable) {
        await client.idle();

        const unseen = await client.search({ seen: false });
        if (!Array.isArray(unseen) || unseen.length === 0) continue;

        for await (const msg of client.fetch(unseen, {
          envelope: true,
          source: true,
        })) {
          await handleMessage(client, msg, brand);
        }
      }
    } catch (err) {
      logger.error({ err }, `IMAP error → ${brand.id}`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

/* =======================================================
   START / STOP
======================================================= */

export async function startIMAPMonitor() {
  const brands = await getActiveImapBrands();

  for (const brand of brands) {
    startIMAPMonitorForBrand(brand);
  }
}

async function startIMAPMonitorForBrand(brand: any) {
  let backoff = 5000;

  while (!shuttingDown) {
    try {
      await monitorBrand(brand);
    } catch (err) {
      logger.error(
        { err },
        `IMAP monitor crashed → ${brand.id}, restarting in ${backoff}ms`,
      );
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

export async function stopIMAPMonitor() {
  shuttingDown = true;

  for (const [brandId, client] of activeClients.entries()) {
    try {
      await client.logout();
      logger.info(`🛑 IMAP stopped → ${brandId}`);
    } catch (err) {
      logger.error({ err }, `Failed stopping IMAP → ${brandId}`);
    }
  }

  activeClients.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
