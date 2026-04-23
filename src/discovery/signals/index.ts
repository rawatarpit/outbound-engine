export { SignalType, SIGNAL_WEIGHTS } from "./types"
export type { Opportunity, BrandIntent, QualificationStatus, EntityType } from "./types"

export { DiscoveryAdapter, createAdapterRegistry, getAdaptersForSignal } from "./adapter"
export type { AdapterParams, AdapterConfig, FetchResult } from "./adapter"

export { generateQueries } from "./queryGenerator"
export { executeSignalDiscovery, defaultAdapters, createAdaptersForBrand, getBrandCredentials } from "./engine"

export { startSignalScheduler, stopSignalScheduler, triggerEnrichmentFromOpportunities } from "./scheduler"