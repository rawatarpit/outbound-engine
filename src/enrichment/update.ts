import pino from "pino"
import { supabase } from "../db/supabase";
import { FinalEnrichmentOutcome, EnrichmentStatus } from "./types";
import { isValidPersonalEmail, isGenericEmail } from "./utils/email-validator";

const logger = pino({ level: "info" })

export async function persistEnrichmentResult(outcome: FinalEnrichmentOutcome) {
  const { type, entityId, finalConfidence, enrichedData, status } = outcome;

  let error: any = null;

  /* ========================================================
     CONTACT PERSISTENCE
  ======================================================== */

  if (type === "contact") {
    const response = await supabase.rpc("update_contact_enrichment", {
      p_contact_id: entityId,
      p_confidence: finalConfidence,
      p_email: enrichedData?.email ?? null,
      p_title: enrichedData?.title ?? null,
      p_linkedin_url: enrichedData?.linkedin_url ?? null,
      p_intent_score: enrichedData?.intent_score ?? null,
      p_status: status,
    });

    error = response.error;

    if (!error && status === EnrichmentStatus.SUCCESS) {
      const { error: scoreError } = await supabase.rpc("rpc_score_lead", {
        p_lead_id: entityId,
      });

      if (scoreError) {
        logger.error(
          { entityId, error: scoreError.message },
          "Failed to score lead after enrichment"
        );
      }
    }
  }

  /* ========================================================
      COMPANY PERSISTMENT
   ======================================================== */

  if (type === "company") {
    // Pre-read discovered_companies BEFORE the RPC (RPC may delete the row)
    const { data: discoveredPre } = await supabase
      .from("discovered_companies")
      .select("brand_id, name, domain, website, confidence, discovered_at")
      .eq("id", entityId)
      .maybeSingle();

    // Update the discovered_companies record
    const response = await supabase.rpc("update_company_enrichment", {
      p_company_id: entityId,
      p_confidence: finalConfidence,
      p_company_name: enrichedData?.company_name ?? null,
      p_website: enrichedData?.website ?? null,
      p_domain: enrichedData?.domain ?? null,
      p_status: status,
    });

    error = response.error;

    // If enrichment succeeded or partial, move to companies table
    if (!error && (status === "SUCCESS" || status === "PARTIAL")) {
      const discovered = discoveredPre;

      if (discovered) {
        const { data: brandProfile } = await supabase
          .from("brand_profiles")
          .select("client_id")
          .eq("id", discovered.brand_id)
          .maybeSingle();

        const { error: insertError } = await supabase
          .from("companies")
          .upsert({
            brand_id: discovered.brand_id,
            client_id: brandProfile?.client_id || null,
            name: discovered.name,
            domain: discovered.domain,
            website: discovered.website,
            status: "researching",
            source: "discovered",
            confidence_score: finalConfidence,
            created_at: discovered.discovered_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: "brand_id,domain" });

        if (insertError) {
          logger.error({ entityId, error: insertError.message }, "Failed to move to companies");
        } else {
          logger.info({ entityId, domain: discovered.domain }, "Moved to companies table");

          // Try to get a contact from discovered_contacts
          const { data: existingContact } = await supabase
            .from("discovered_contacts")
            .select("id, email, full_name, first_name, last_name, title, linkedin_url")
            .eq("discovered_company_id", entityId)
            .eq("brand_id", discovered.brand_id)
            .order("confidence", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingContact) {
            // Use enriched data if available, otherwise fall back to discovered contact
            const firstName = enrichedData?.first_name || existingContact.first_name || existingContact.full_name?.split(" ")[0] || null;
            const lastName = enrichedData?.last_name || existingContact.last_name || existingContact.full_name?.split(" ").slice(1).join(" ") || null;
            const fullName = enrichedData?.full_name || existingContact.full_name || null;
            const emailToUse = enrichedData?.email && isValidPersonalEmail(enrichedData.email)
              ? enrichedData.email
              : existingContact.email;
            const title = enrichedData?.title || existingContact.title || null;
            const linkedinUrl = enrichedData?.linkedin_url || existingContact.linkedin_url || null;

            if (!emailToUse) {
              logger.info(
                { entityId, domain: discovered.domain },
                "Skipping lead creation — contact has no email"
              );
            } else if (isGenericEmail(emailToUse)) {
              logger.info(
                { email: emailToUse, domain: discovered.domain },
                "Skipping lead creation — generic email"
              );
            } else {
              const { error: leadError } = await supabase.rpc("rpc_ingest_lead", {
                p_brand_id: discovered.brand_id,
                p_client_id: brandProfile?.client_id || null,
                p_first_name: firstName,
                p_last_name: lastName,
                p_full_name: fullName,
                p_email: emailToUse.toLowerCase(),
                p_title: title,
                p_company_name: discovered.name ?? null,
                p_domain: discovered.domain?.toLowerCase() ?? null,
                p_linkedin_url: linkedinUrl,
                p_source: "contact_discovery",
                p_source_id: existingContact.id ?? null,
                p_raw_payload: {
                  company_id: entityId,
                  confidence: finalConfidence,
                },
              });

              if (leadError) {
                logger.error(
                  { email: emailToUse, error: leadError.message },
                  "Failed to ingest lead from contact discovery"
                );
              } else {
                logger.info(
                  { name: fullName, email: emailToUse, company: discovered.name },
                  "Lead ingested from contact discovery"
                );
              }
            }
          } else {
            logger.info(
              { entityId, domain: discovered.domain },
              "No discovered contacts found — skipping lead creation"
            );
          }
        }
      }
    }
  }

  if (error) {
    throw error;
  }
}
