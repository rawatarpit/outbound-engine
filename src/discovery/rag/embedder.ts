import axios from "axios"
import pino from "pino"
import { supabase, getClientLLMSettings } from "../../db/supabase"
import type { BrandProfile, BrandIntent } from "../../db/supabase"

const logger = pino({ level: "info" })

const GROQ_EMBEDDING_URL = "https://api.groq.com/openai/v1/embeddings"
const EMBEDDING_MODEL = "nomic-embed-text-v1.5"
const EMBEDDING_DIM = 768

// Groq does not support the /embeddings endpoint — skip if provider is groq
const activeProvider = (process.env.LLM_PROVIDER || "ollama").toLowerCase()
let embeddingAvailable = activeProvider !== "groq"

async function getApiKey(clientId?: string): Promise<string> {
  if (clientId) {
    try {
      const settings = await getClientLLMSettings(clientId)
      if (settings?.llm_api_key) return settings.llm_api_key
    } catch {
      logger.warn("Failed to get client LLM settings for embedding, falling back to env")
    }
  }
  return process.env.LLM_API_KEY || ""
}

export async function embed(text: string, clientId?: string): Promise<number[]> {
  if (!embeddingAvailable) {
    throw new Error("Embedding API is not available")
  }

  const apiKey = await getApiKey(clientId)
  if (!apiKey) {
    throw new Error("No LLM_API_KEY configured for embeddings")
  }

  try {
    const response = await axios.post(
      GROQ_EMBEDDING_URL,
      {
        model: EMBEDDING_MODEL,
        input: text,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    )

    const embedding: number[] = response.data.data[0]?.embedding
    if (!embedding || embedding.length !== EMBEDDING_DIM) {
      throw new Error(`Expected ${EMBEDDING_DIM}-dim embedding, got ${embedding?.length || 0}`)
    }

    return embedding
  } catch (err: any) {
    if (err?.response?.status === 401 || err?.response?.status === 404) {
      embeddingAvailable = false
      logger.info(`Embedding API returned ${err?.response?.status} — disabling embeddings for this session`)
    }
    throw err
  }
}

export async function embedBatch(texts: string[], clientId?: string): Promise<number[][]> {
  const apiKey = await getApiKey(clientId)
  if (!apiKey) {
    throw new Error("No LLM_API_KEY configured for embeddings")
  }

  const results: number[][] = []
  const BATCH_SIZE = 20

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const response = await axios.post(
      GROQ_EMBEDDING_URL,
      {
        model: EMBEDDING_MODEL,
        input: batch,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    )

    for (const item of response.data.data) {
      results.push(item.embedding)
    }

    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return results
}

export async function embedAndStore(
  brandId: string,
  contentText: string,
  contentType: "brand_intent" | "signal_pattern" | "reference_company" | "converted_lead" | "rejected_lead",
  intentId?: string,
  metadata: Record<string, unknown> = {},
  clientId?: string,
): Promise<string | null> {
  try {
    const embedding = await embed(contentText, clientId)

    const { data, error } = await supabase
      .from("discovery_embeddings")
      .insert({
        brand_id: brandId,
        intent_id: intentId || null,
        content_type: contentType,
        content_text: contentText,
        embedding: `[${embedding.join(",")}]`,
        metadata,
      })
      .select("id")
      .single()

    if (error) {
      logger.error({ error: error.message }, "Failed to store embedding")
      return null
    }

    return data.id
  } catch (err: any) {
    if (err.message === "Embedding API is not available") {
      logger.debug("Embedding API unavailable, skipping")
    } else {
      logger.warn({ error: err.message }, "embedAndStore failed")
    }
    return null
  }
}

export async function syncBrandEmbeddings(
  brand: BrandProfile,
  intents: BrandIntent[],
  clientId?: string,
): Promise<number> {
  let synced = 0

  if (!embeddingAvailable) {
    logger.debug("Embedding API unavailable — skipping brand embedding sync")
    return 0
  }

  // Sync brand intents
  for (const intent of intents) {
    if (!intent.is_active) continue

    const contentText = [
      `Intent: ${intent.intent}`,
      `Signals: ${intent.signals.join(", ")}`,
    ].join("\n")

    const existing = await supabase
      .from("discovery_embeddings")
      .select("id")
      .eq("intent_id", intent.id)
      .eq("content_type", "brand_intent")
      .maybeSingle()

    if (existing.data) {
      try {
        const embedding = await embed(contentText, clientId)
        if (!embedding) continue

        const { error } = await supabase
          .from("discovery_embeddings")
          .update({
            content_text: contentText,
            embedding: `[${embedding.join(",")}]`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.data.id)

        if (!error) synced++
      } catch (err: any) {
        logger.warn({ error: err.message, intent: intent.intent }, "Failed to update embedding, skipping")
      }
    } else {
      const id = await embedAndStore(
        brand.id, contentText, "brand_intent",
        intent.id, { signals: intent.signals }, clientId,
      )
      if (id) synced++
    }
  }

  // Sync reference companies (converted leads)
  const { data: convertedLeads } = await supabase
    .from("companies")
    .select("id, name, domain, status")
    .eq("brand_id", brand.id)
    .in("status", ["closed_won", "rejected"])
    .limit(50)

  if (convertedLeads && convertedLeads.length) {
    for (const lead of convertedLeads) {
      const contentType = lead.status === "closed_won" ? "converted_lead" : "rejected_lead"
      const contentText = [
        `Company: ${lead.name || "Unknown"}`,
        `Domain: ${lead.domain || "unknown"}`,
        `Outcome: ${contentType === "converted_lead" ? "Converted" : "Rejected"}`,
      ].join("\n")

      const existing = await supabase
        .from("discovery_embeddings")
        .select("id")
        .eq("content_type", contentType)
        .eq("metadata->>company_id", lead.id)
        .maybeSingle()

      if (existing.data) {
        try {
          const embedding = await embed(contentText, clientId)
          if (!embedding) continue

          const { error } = await supabase
            .from("discovery_embeddings")
            .update({
              content_text: contentText,
              embedding: `[${embedding.join(",")}]`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.data.id)

          if (!error) synced++
        } catch (err: any) {
          logger.warn({ error: err.message, company: lead.name }, "Failed to update outcome embedding, skipping")
        }
      } else {
        const id = await embedAndStore(
          brand.id, contentText, contentType,
          null, { company_id: lead.id, company_name: lead.name, domain: lead.domain }, clientId,
        )
        if (id) synced++
      }
    }
  }

  // Sync enriched discovered companies as reference companies
  const { data: enrichedCompanies } = await supabase
    .from("discovered_companies")
    .select("id, name, domain, enrichment_status, raw_payload")
    .eq("brand_id", brand.id)
    .eq("enrichment_status", "success")
    .limit(20)

  if (enrichedCompanies && enrichedCompanies.length) {
    for (const company of enrichedCompanies) {
      const contentText = [
        `Company: ${company.name || "Unknown"}`,
        `Domain: ${company.domain || "unknown"}`,
        `Industry: ${(company.raw_payload as any)?.industry || "unknown"}`,
        `Enrichment: Success`,
      ].join("\n")

      const existing = await supabase
        .from("discovery_embeddings")
        .select("id")
        .eq("content_type", "reference_company")
        .eq("metadata->>company_id", company.id)
        .maybeSingle()

      if (existing.data) {
        try {
          const embedding = await embed(contentText, clientId)
          if (!embedding) continue

          const { error } = await supabase
            .from("discovery_embeddings")
            .update({
              content_text: contentText,
              embedding: `[${embedding.join(",")}]`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.data.id)

          if (!error) synced++
        } catch (err: any) {
          logger.warn({ error: err.message, company: company.name }, "Failed to update reference embedding, skipping")
        }
      } else {
        const id = await embedAndStore(
          brand.id, contentText, "reference_company",
          null, { company_id: company.id, company_name: company.name, domain: company.domain }, clientId,
        )
        if (id) synced++
      }
    }
  }

  logger.info({ brand: brand.brand_name, synced }, "Brand embeddings synced")
  return synced
}
