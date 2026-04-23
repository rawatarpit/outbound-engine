import { z } from "zod"
import pino from "pino"
import type { SignalType, Opportunity } from "./types"

const logger = pino({ level: "debug" })

export interface AdapterParams {
  query: string
  signal: SignalType
}

export interface FetchResult {
  raw: unknown[]
  metadata?: Record<string, unknown>
}

export interface AdapterConfig {
  apiKey?: string
  maxResults?: number
  [key: string]: unknown
}

export const baseConfigSchema = z.object({
  apiKey: z.string().optional(),
  maxResults: z.number().min(1).max(100).default(20),
})

export abstract class DiscoveryAdapter {
  abstract source: string
  abstract supportedSignals: SignalType[]

  protected config: z.infer<typeof baseConfigSchema> & AdapterConfig

  constructor(config: AdapterConfig = {}) {
    this.config = { ...baseConfigSchema.parse({}), ...config }
  }

  abstract fetch(params: AdapterParams): Promise<FetchResult>

  abstract normalize(raw: unknown[]): Opportunity[]

  supports(signal: SignalType): boolean {
    return this.supportedSignals.includes(signal)
  }

  protected createOpportunity(
    partial: Partial<Opportunity> & Pick<Opportunity, "name" | "source" | "signal" | "confidence">,
  ): Opportunity {
    return {
      entity_type: "company",
      confidence: 0.5,
      ...partial,
    }
  }

  protected parseConfidence(raw: unknown): number {
    if (typeof raw === "number") {
      return Math.min(1, Math.max(0, raw))
    }
    if (typeof raw === "string") {
      const parsed = parseFloat(raw)
      return isNaN(parsed) ? 0.5 : Math.min(1, Math.max(0, parsed))
    }
    return 0.5
  }

  protected extractDomain(url?: string): string | undefined {
    if (!url) return undefined

    try {
      const parsed = new URL(url)
      return parsed.hostname.replace(/^www\./, "")
    } catch {
      const match = url.match(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/)
      return match?.[1] ?? url
    }
  }
}

export function createAdapterRegistry<T extends DiscoveryAdapter>(
  adapters: T[],
): Map<string, T> {
  const registry = new Map<string, T>()

  for (const adapter of adapters) {
    if (registry.has(adapter.source)) {
      logger.warn(
        { duplicate: adapter.source },
        "Adapter already registered",
      )
    }
    registry.set(adapter.source, adapter)
  }

  return registry
}

export function getAdaptersForSignal(
  registry: Map<string, DiscoveryAdapter>,
  signal: SignalType,
): DiscoveryAdapter[] {
  const result: DiscoveryAdapter[] = []

  for (const adapter of registry.values()) {
    if (adapter.supports(signal)) {
      result.push(adapter)
    }
  }

  return result
}