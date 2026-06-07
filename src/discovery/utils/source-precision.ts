import fs from "fs"
import path from "path"
import pino from "pino"

const logger = pino({ level: "info" })

const PRECISION_FILE = path.resolve(process.cwd(), "data", "source-precision.json")

interface SourcePrecisionEntry {
  totalSignals: number
  endClientSignals: number
  providerSignals: number
  falsePositives: number
  precision: number
  signalToNoiseRatio: number
  lastUpdated: number
  weight: number
}

interface PrecisionStore {
  sources: Record<string, SourcePrecisionEntry>
}

function load(): PrecisionStore {
  try {
    if (fs.existsSync(PRECISION_FILE)) {
      return JSON.parse(fs.readFileSync(PRECISION_FILE, "utf-8"))
    }
  } catch { }
  return { sources: {} }
}

function save(store: PrecisionStore): void {
  const dir = path.dirname(PRECISION_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(PRECISION_FILE, JSON.stringify(store, null, 2))
}

function getOrCreate(store: PrecisionStore, source: string): SourcePrecisionEntry {
  if (!store.sources[source]) {
    store.sources[source] = {
      totalSignals: 0,
      endClientSignals: 0,
      providerSignals: 0,
      falsePositives: 0,
      precision: 0.5,
      signalToNoiseRatio: 1.0,
      lastUpdated: Date.now(),
      weight: 1.0,
    }
  }
  return store.sources[source]
}

export function recordEndClientSignal(source: string): void {
  const store = load()
  const entry = getOrCreate(store, source)
  entry.totalSignals++
  entry.endClientSignals++
  entry.lastUpdated = Date.now()
  recalc(entry)
  save(store)
}

export function recordProviderSignal(source: string): void {
  const store = load()
  const entry = getOrCreate(store, source)
  entry.totalSignals++
  entry.providerSignals++
  entry.lastUpdated = Date.now()
  recalc(entry)
  save(store)
}

export function recordFalsePositive(source: string): void {
  const store = load()
  const entry = getOrCreate(store, source)
  entry.totalSignals++
  entry.falsePositives++
  entry.lastUpdated = Date.now()
  recalc(entry)
  save(store)
}

function recalc(entry: SourcePrecisionEntry): void {
  if (entry.totalSignals === 0) {
    entry.precision = 0.5
    entry.signalToNoiseRatio = 1.0
    entry.weight = 1.0
    return
  }
  entry.precision = entry.endClientSignals / Math.max(entry.totalSignals, 1)
  const noise = entry.providerSignals + entry.falsePositives
  entry.signalToNoiseRatio = noise === 0
    ? entry.endClientSignals + 1
    : (entry.endClientSignals + 1) / (noise + 1)
  entry.weight = Math.min(2.0, Math.max(0.1, entry.precision * 2))
}

export function getSourceWeight(source: string): number {
  const store = load()
  const entry = store.sources[source]
  if (!entry || entry.totalSignals < 5) return 1.0
  return entry.weight
}

export function getSourcePrecision(source: string): number {
  const store = load()
  const entry = store.sources[source]
  if (!entry) return 0.5
  return entry.precision
}

export function getSourceHealth(source: string): "healthy" | "degraded" | "blocked" {
  const store = load()
  const entry = store.sources[source]
  if (!entry || entry.totalSignals < 5) return "healthy"
  if (entry.precision < 0.2) return "blocked"
  if (entry.precision < 0.4) return "degraded"
  return "healthy"
}

export function getSourcePrecisionSummary(): Record<string, { precision: string; snr: string; weight: string; total: number }> {
  const store = load()
  const summary: Record<string, any> = {}
  for (const [source, entry] of Object.entries(store.sources)) {
    summary[source] = {
      precision: (entry.precision * 100).toFixed(0) + "%",
      snr: entry.signalToNoiseRatio.toFixed(1),
      weight: entry.weight.toFixed(2),
      total: entry.totalSignals,
    }
  }
  return summary
}

export function resetSourcePrecision(source: string): void {
  const store = load()
  delete store.sources[source]
  save(store)
  logger.info({ source }, "Source precision data reset")
}
