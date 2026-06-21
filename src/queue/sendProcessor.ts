import crypto from "crypto";
import pino from "pino";

import {
  claimCompanies,
  updateCompanyStatus,
  registerFailure,
  markLeadContacted,
  getBrandProfile,
  claimOutreachDraft,
  consumeSendQuota,
  scheduleRetry,
  supabase,
} from "../db/supabase";

import { getProvider } from "../email/providers";

import {
  canSend,
  recordFailure,
  recordSuccess,
} from "../reputation/circuitBreaker";

import {
  getBackoffDelay,
  recordSoftFailure,
  resetBackoff,
} from "../reputation/backoffEngine";

import {
  checkDomainHealth,
  reserveQuota,
  recordBounceAndCheckHealth,
} from "../reputation/domainReputation";

import {
  isTransportUnstable,
  recordTransportFailure,
} from "../reputation/smtpHealthGuard";

import { isBrandReputationSafe } from "../reputation/domainHealthEngine";

const logger = pino({ level: "info" });
const BATCH_LIMIT = 5;

/* =========================================================
   HELPERS
========================================================= */

function buildMessageKey(companyId: string, brandId: string) {
  return crypto
    .createHash("sha256")
    .update(`${companyId}-${brandId}-initial`)
    .digest("hex");
}

function classifyTransportError(err: any): "hard" | "soft" | "unknown" {
  const message = err?.message || "";

  if (/5\d\d|550|554/.test(message)) return "hard";
  if (/4\d\d|421|451/.test(message)) return "soft";

  return "unknown";
}

/* =========================================================
   MAIN PROCESSOR
========================================================= */

export async function processSendQueue(brandId: string) {
  /* -----------------------------------------
     BRAND GATING (CRITICAL)
  ------------------------------------------ */

  const brand = await getBrandProfile(brandId);

  if (!brand) return;
  if (brand.is_paused) return;
  if (!brand.outbound_enabled) return;

  /* -----------------------------------------
     CLAIM COMPANIES
  ------------------------------------------ */

  const companies = await claimCompanies(brandId, "draft_ready", BATCH_LIMIT);

  if (!companies.length) return;

  for (const company of companies) {
    const deterministicId = buildMessageKey(company.id, brandId);
    let domain = "";

    try {
      /* -----------------------------------------
         SYSTEM SAFETY CHECKS
      ------------------------------------------ */

      if (!canSend(brandId) || isTransportUnstable(brandId)) {
        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "draft_ready",
          brandId,
        );
        continue;
      }

      if (brand.auto_paused || !isBrandReputationSafe(brand)) {
        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "draft_ready",
          brandId,
        );
        continue;
      }

      domain =
        brand.transport_mode === "api"
          ? brand.sending_domain || brand.smtp_email?.split("@")[1] || "unknown"
          : brand.smtp_email?.split("@")[1] || "unknown";

      /* -----------------------------------------
         CLAIM OUTREACH
      ----------------------------------------- */

      const outreach = await claimOutreachDraft(company.id);

      if (!outreach) {
        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "draft_ready",
          brandId,
        );
        continue;
      }

      /* -----------------------------------------
         FETCH LEAD EMAIL
      ------------------------------------------ */

      const { data: lead, error } = await supabase
        .from("leads")
        .select("email, confidence_score, id")
        .eq("id", outreach.lead_id)
        .single();

      if (error || !lead?.email) {
        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "rejected",
          brandId,
        );
        continue;
      }

      if (lead.confidence_score !== null && lead.confidence_score < 0.5) {
        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "rejected",
          brandId,
        );
        continue;
      }

      /* -----------------------------------------
         QUOTA ENFORCEMENT
      ------------------------------------------ */

      const domainHealth = await checkDomainHealth(brandId, domain);
      if (!domainHealth.isHealthy) {
        logger.warn(
          { domain, bounceRate: domainHealth.bounceRate },
          "Domain unhealthy, skipping send",
        );
        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "draft_ready",
          brandId,
        );
        continue;
      }

      const quotaResult = await reserveQuota(brandId, domain);
      if (!quotaResult.allowed) {
        logger.warn(
          { domain, reason: quotaResult.reason },
          "Quota not available",
        );
        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "draft_ready",
          brandId,
        );
        continue;
      }

      /* -----------------------------------------
         IDEMPOTENCY GUARD (RESERVE BEFORE SEND)
      ------------------------------------------ */

      const { data: existing } = await supabase
        .from("sent_messages")
        .select("id")
        .eq("message_key", deterministicId)
        .maybeSingle();

      if (existing) {
        logger.warn(
          { deterministicId },
          "Duplicate message detected, skipping",
        );

        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "contacted",
          brandId,
        );

        continue;
      }

      const { error: reserveError } = await supabase
        .from("sent_messages")
        .insert({
          brand_id: brandId,
          lead_id: lead.id,
          company_id: company.id,
          message_key: deterministicId,
          direction: "outbound",
          status: "pending",
          smtp_message_id: null,
        });

      if (reserveError?.code === "23505") {
        logger.warn(
          { deterministicId },
          "Race condition: message already reserved",
        );
        continue;
      }

      if (reserveError) {
        logger.error({ reserveError }, "Failed to reserve idempotency key");
        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "draft_ready",
          brandId,
        );
        continue;
      }

      /* -----------------------------------------
         PROVIDER SEND
      ------------------------------------------ */

      const provider = await getProvider(brand);

      const transportMessageId = await provider.send({
        brandId,
        brandName: brand.brand_name,
        to: lead.email,
        subject: outreach.subject,
        body: outreach.body,
        threadMeta: {
          companyId: company.id,
          leadId: outreach.lead_id,
        },
        messageKey: deterministicId,
      });

      /* -----------------------------------------
         RECORD MESSAGE (UPDATE RESERVED)
      ------------------------------------------ */

      const { error: updateError } = await supabase
        .from("sent_messages")
        .update({
          status: "sent",
          smtp_message_id: transportMessageId,
          sent_at: new Date().toISOString(),
        })
        .eq("message_key", deterministicId);

      if (updateError) {
        logger.error(
          { messageKey: deterministicId, error: updateError.message },
          "Failed to update sent message status"
        );
      }

      const success = await markLeadContacted(
        outreach.lead_id,
        outreach.subject,
        outreach.body,
        transportMessageId,
      );

      if (!success) {
        await updateCompanyStatus(
          company.id,
          "draft_ready_processing",
          "draft_ready",
          brandId,
        );
        continue;
      }

      await updateCompanyStatus(
        company.id,
        "draft_ready_processing",
        "contacted",
        brandId,
      );

      recordSuccess(brandId);
      resetBackoff(brandId);

      logger.info(`📤 Sent → ${company.name}`);

      await new Promise((r) => setTimeout(r, getBackoffDelay(brandId)));
    } catch (err: any) {
      const classification = classifyTransportError(err);

      logger.error({ err: err?.message, classification }, "Send error");

      recordTransportFailure(brandId);

      if (classification === "hard") {
        recordFailure(brandId);
        await recordBounceAndCheckHealth(brandId, domain, true);
      }

      if (classification === "soft") {
        recordSoftFailure(brandId);
        await recordBounceAndCheckHealth(brandId, domain, false);
      }

      await registerFailure("company", company.id, err.message);

      if (classification !== "hard") {
        try {
          await scheduleRetry(company.id, err.message);
        } catch (retryErr: any) {
          logger.warn({ leadId: company.id, error: retryErr.message }, "scheduleRetry failed (lead may not exist)");
        }
      }

      await updateCompanyStatus(
        company.id,
        "draft_ready_processing",
        "draft_ready",
        brandId,
      );
    }
  }
}

export async function sendImmediately(
  draftId: string,
  brandId: string,
): Promise<boolean> {
  const brand = await getBrandProfile(brandId);
  if (!brand || brand.is_paused) {
    logger.warn({ brandId }, "Brand cannot send");
    return false;
  }

  const { data: draft } = await supabase
    .from("outreach")
    .select("*, companies!inner(id, name, lead_score, domain)")
    .eq("id", draftId)
    .single();

  if (!draft) {
    logger.warn({ draftId }, "Draft not found");
    return false;
  }

  const company = draft.companies as any;
  const messageKey = buildMessageKey(company.id, brandId);

  if (!company.domain && !brand.sending_domain) {
    logger.warn({ draftId }, "No sending domain available");
    return false;
  }

  const domain = brand.sending_domain || company.domain;

  try {
    const transportStable = await isTransportUnstable(brandId);
    if (transportStable) {
      logger.warn({ brandId }, "Transport unstable, skipping send");
      return false;
    }

    const hasQuota = await consumeSendQuota(brandId, domain);
    if (!hasQuota) {
      logger.warn({ brandId, domain }, "No send quota available");
      return false;
    }

    const { data: existing } = await supabase
      .from("sent_messages")
      .select("id")
      .eq("message_key", messageKey)
      .maybeSingle();

    if (existing) {
      logger.info({ messageKey }, "Message already sent");
      return true;
    }

    await supabase.from("sent_messages").insert({
      company_id: company.id,
      brand_id: brandId,
      message_key: messageKey,
      subject: draft.subject,
      body: draft.body,
      status: "pending",
    });

    const { data: leadMap } = await supabase
      .from("lead_company_map")
      .select("lead_id")
      .eq("company_id", company.id)
      .maybeSingle();

    let toEmail = "";
    if (leadMap?.lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("email")
        .eq("id", leadMap.lead_id)
        .maybeSingle();
      toEmail = lead?.email || "";
    }

    if (!toEmail) {
      logger.warn({ companyId: company.id }, "No recipient email");
      return false;
    }

    const provider = await (await import("../email/providers")).getProvider(brand);

    const transportMessageId = await provider.send({
      brandId,
      brandName: brand.brand_name,
      to: toEmail,
      subject: draft.subject,
      body: draft.body,
      threadMeta: { companyId: company.id, leadId: leadMap?.lead_id },
      messageKey,
    });

    await supabase
      .from("sent_messages")
      .update({ status: "sent", smtp_message_id: transportMessageId, sent_at: new Date().toISOString() })
      .eq("message_key", messageKey);

    if (leadMap?.lead_id) {
      await markLeadContacted(leadMap.lead_id, draft.subject, draft.body, transportMessageId || "");
    }

    await updateCompanyStatus(company.id, "draft_ready_processing", "contacted", brandId);
    recordSuccess(brandId);
    resetBackoff(brandId);

    await supabase
      .from("outreach")
      .update({ status: "sent", sent_at: new Date().toISOString(), message_id: transportMessageId })
      .eq("id", draftId);

    logger.info({ draftId, company: company.name }, "Draft sent immediately");
    return true;
  } catch (err: any) {
    logger.error({ err: err.message, draftId }, "Immediate send failed");
    return false;
  }
}
