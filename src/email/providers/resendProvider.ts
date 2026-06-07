import { Resend } from "resend";
import pino from "pino";
import { EmailProvider, SendPayload } from "./types";
import { supabase } from "../../db/supabase";

const logger = pino({ level: "info" });

interface ResendBrandConfig {
  provider_api_key: string;
  sending_domain: string;
  brand_name: string;
  smtp_email: string | null;
  reply_to_email: string | null;
}

async function getResendConfig(brandId: string): Promise<ResendBrandConfig> {
  const { data, error } = await supabase
    .from("brand_profiles")
    .select(
      "provider_api_key, sending_domain, brand_name, smtp_email, reply_to_email",
    )
    .eq("id", brandId)
    .single();

  if (error || !data) {
    throw new Error(`Missing brand profile for Resend provider → ${brandId}`);
  }

  if (!data.provider_api_key) {
    throw new Error(`Missing provider_api_key for brand → ${brandId}`);
  }

  if (!data.sending_domain) {
    throw new Error(`Missing sending_domain for brand → ${brandId}`);
  }

  return data as ResendBrandConfig;
}

export class ResendProvider implements EmailProvider {
  async send(payload: SendPayload): Promise<string> {
    const { brandId, to, subject, body } = payload;

    const config = await getResendConfig(brandId);

    const resend = new Resend(config.provider_api_key);

    const fromEmail = config.smtp_email || `outbound@${config.sending_domain}`;

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.brand_name} <${fromEmail}>`,
        to,
        subject,
        text: body,
        replyTo: config.reply_to_email || undefined,
      });

      if (error || !data?.id) {
        throw new Error(error?.message || "Resend send failed");
      }

/* =====================================
          DOMAIN METRIC UPDATE (same RPC)
       ====================================== */

      const { error: metricError } = await supabase.rpc("rpc_increment_domain_metric", {
        p_product: brandId,
        p_metric: "sent",
      });

      if (metricError) {
        logger.error(
          { brandId, error: metricError.message },
          "Failed to increment domain metric"
        );
      }

      logger.info(`Resend email sent → ${brandId} → ${data.id}`);

      return data.id;
    } catch (err: any) {
      logger.error({ err: err?.message, brandId }, "Resend send error");

      /* =====================================
         Soft/Hard classification delegated
         to sendProcessor catch block
      ====================================== */

      throw err;
    }
  }
}
