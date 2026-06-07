export type DiscoverySource = "google" | "reddit" | "hackernews" | "news" | "jobs" | "freelance" | "blogs" | "community" | "github" | "hn_hiring" | "yc" | "producthunt" | "indeed" | "crunchbase" | "wellfound" | "techcrunch" | "pushshift" | "stackshare" | "web_research" | "forge_enrichment"

export interface RAGQuery {
  text: string
  source: DiscoverySource
  intent_id: string
  signal: string
  rag_context: string
}

export interface EmbeddingRecord {
  id: string
  brand_id: string
  intent_id: string | null
  content_type: "brand_intent" | "signal_pattern" | "reference_company" | "converted_lead" | "rejected_lead"
  content_text: string
  metadata: Record<string, unknown>
}

export interface SimilarIntent {
  intent_id: string
  intent_text: string
  signal: string
  similarity: number
}
