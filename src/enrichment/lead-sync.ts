import pino from "pino"
import { supabase } from "../db/supabase";
import { isValidPersonalEmail, isGenericEmail } from "./utils/email-validator";

const logger = pino({ level: "info" })

export async function syncCompanyLeads(brandId?: string) {
  let query = supabase
    .from("companies")
    .select("id, name, domain, brand_id, client_id");

  if (brandId) {
    query = query.eq("brand_id", brandId);
  }

  const { data: companies, error: fetchError } = await query;

  if (fetchError) {
    logger.error({ error: fetchError.message }, "Failed to fetch companies for lead sync");
    return;
  }

  if (!companies?.length) return;

  let synced = 0;
  let skipped = 0;

  for (const company of companies) {
    const { data: existing } = await supabase
      .from("lead_company_map")
      .select("lead_id")
      .eq("company_id", company.id)
      .limit(1)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    const { data: discovered } = await supabase
      .from("discovered_companies")
      .select("id")
      .eq("domain", company.domain)
      .eq("brand_id", company.brand_id)
      .maybeSingle();

    if (!discovered) {
      skipped++;
      continue;
    }

    const { data: contact } = await supabase
      .from("discovered_contacts")
      .select("id, email, full_name, first_name, last_name, title, linkedin_url, confidence")
      .eq("discovered_company_id", discovered.id)
      .eq("brand_id", company.brand_id)
      .order("confidence", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!contact) {
      skipped++;
      continue;
    }

    const emailToUse = contact.email;
    if (!emailToUse) {
      skipped++;
      continue;
    }
    if (!isValidPersonalEmail(emailToUse) || isGenericEmail(emailToUse)) {
      skipped++;
      continue;
    }

    const firstName = contact.first_name || contact.full_name?.split(" ")[0] || null;
    const lastName = contact.last_name || contact.full_name?.split(" ").slice(1).join(" ") || null;

    const { error: leadError } = await supabase.rpc("rpc_ingest_lead", {
      p_brand_id: company.brand_id,
      p_client_id: company.client_id ?? null,
      p_first_name: firstName,
      p_last_name: lastName,
      p_full_name: contact.full_name ?? null,
      p_email: emailToUse.toLowerCase(),
      p_title: contact.title ?? null,
      p_company_name: company.name ?? null,
      p_domain: company.domain?.toLowerCase() ?? null,
      p_linkedin_url: contact.linkedin_url ?? null,
      p_source: "contact_discovery",
      p_source_id: contact.id ?? null,
      p_raw_payload: { synced_by: "lead-sync" },
    });

    if (leadError) {
      logger.error(
        { email: emailToUse, company: company.name, error: leadError.message },
        "Failed to sync lead for company"
      );
    } else {
      logger.info(
        { name: contact.full_name, email: emailToUse, company: company.name },
        "Lead synced from discovered contacts"
      );
      synced++;
    }
  }

  if (synced > 0 || skipped > 0) {
    logger.info({ synced, skipped, total: companies.length }, "Lead sync completed");
  }
}
