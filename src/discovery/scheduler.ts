import pino from "pino";
import { setTimeout as sleep } from "timers/promises";

import {
  claimDiscoverySources,
  releaseDiscoverySource,
  getBrandProfile,
  DiscoverySource,
  supabase,
} from "../db/supabase";

import { executeSource } from "./engine";

const logger = pino({ level: "debug" });

const CLAIM_BATCH_SIZE = 5;
const LOOP_INTERVAL_MS = 10_000;
const MAX_CONCURRENT_EXECUTIONS = 5;
const DEFAULT_BRAND_DISCOVERY_LIMIT = 100;

let isRunning = false;

/* =========================================================
   BRAND DISCOVERY COUNTERS (IN-MEMORY, PERSISTED TO DB)
========================================================= */

const brandDiscoveryCounts = new Map<string, { count: number; date: string }>();

function getBrandDiscoveryLimit(
  brand: Awaited<ReturnType<typeof getBrandProfile>>,
): number {
  if (!brand) return 0;
  return brand.discovery_daily_limit ?? DEFAULT_BRAND_DISCOVERY_LIMIT;
}

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

async function getBrandDiscoveryCount(brandId: string): Promise<number> {
  const today = getTodayDateString();
  const entry = brandDiscoveryCounts.get(brandId);

  if (entry && entry.date === today) {
    return entry.count;
  }

  const brand = await getBrandProfile(brandId);
  if (brand?.last_discovery_date === today) {
    return brand.discovery_count_today ?? 0;
  }
  return 0;
}

async function incrementBrandDiscoveryCount(brandId: string): Promise<void> {
  const today = getTodayDateString();
  const current = brandDiscoveryCounts.get(brandId);

  let newCount = 1;
  if (current && current.date === today) {
    newCount = current.count + 1;
  }

  brandDiscoveryCounts.set(brandId, { count: newCount, date: today });

  const { error } = await supabase
    .from("brand_profiles")
    .update({
      discovery_count_today: newCount,
      last_discovery_date: today,
    })
    .eq("id", brandId);

  if (error) {
    logger.error(
      { brandId, error: error.message },
      "Failed to update brand discovery count"
    );
  }
}

async function isBrandDiscoveryExhausted(
  brand: Awaited<ReturnType<typeof getBrandProfile>>,
): Promise<boolean> {
  if (!brand) return true;

  const limit = getBrandDiscoveryLimit(brand);
  const current = await getBrandDiscoveryCount(brand.id);

  return current >= limit;
}

/* =========================================================
   BRAND EXECUTION LOCK (CRITICAL)
========================================================= */

const activeBrandExecutions = new Set<string>();

function isBrandActive(brandId: string): boolean {
  return activeBrandExecutions.has(brandId);
}

function lockBrand(brandId: string) {
  activeBrandExecutions.add(brandId);
}

function unlockBrand(brandId: string) {
  activeBrandExecutions.delete(brandId);
}

/* =========================================================
   RATE LIMIT TRACKER (PER SOURCE)
========================================================= */

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(source: DiscoverySource): boolean {
  if (!source.rate_limit_per_min) return true;

  const now = Date.now();
  const bucket = rateBuckets.get(source.id);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(source.id, {
      count: 1,
      resetAt: now + 60_000,
    });
    return true;
  }

  if (bucket.count >= source.rate_limit_per_min) {
    return false;
  }

  bucket.count++;
  return true;
}

/* =========================================================
   PROCESS SOURCE (SAFE)
========================================================= */

async function processSource(source: DiscoverySource) {
  if (isBrandActive(source.brand_id)) {
    logger.debug(
      { brandId: source.brand_id },
      "Skipping source - brand already active",
    );
    return;
  }

  lockBrand(source.brand_id);

  try {
    const brand = await getBrandProfile(source.brand_id);

    if (!brand || brand.is_paused || !brand.discovery_enabled) {
      await releaseDiscoverySource({
        source_id: source.id,
        success: false,
        error: "Discovery disabled for brand",
      });
      return;
    }

    if (await isBrandDiscoveryExhausted(brand)) {
      logger.info(
        { brandId: brand.id, limit: getBrandDiscoveryLimit(brand) },
        "Brand daily discovery limit exhausted",
      );
      await releaseDiscoverySource({
        source_id: source.id,
        success: false,
        error: "Brand daily discovery limit exhausted",
      });
      return;
    }

    if (!checkRateLimit(source)) {
      await releaseDiscoverySource({
        source_id: source.id,
        success: false,
        error: "Rate limit exceeded",
      });
      return;
    }

    if (!source.config || Object.keys(source.config).length === 0) {
      logger.warn({ sourceId: source.id }, "Source has empty config, skipping");
      await releaseDiscoverySource({
        source_id: source.id,
        success: false,
        error: "Empty configuration",
      });
      return;
    }

    await executeSource(source);

    await incrementBrandDiscoveryCount(source.brand_id);
  } catch (error: any) {
    logger.error(
      { sourceId: source.id, error: error?.message },
      "Discovery source failed",
    );

    await releaseDiscoverySource({
      source_id: source.id,
      success: false,
      error: error?.message ?? "Unknown error",
    });
  } finally {
    unlockBrand(source.brand_id);
  }
}

/* =========================================================
   INITIALIZE BRAND COUNTS FROM DB
========================================================= */

async function initializeBrandDiscoveryCounts() {
  const { supabase } = await import("../db/supabase");

  const today = getTodayDateString();

  const { data: brands, error } = await supabase
    .from("brand_profiles")
    .select("id, discovery_count_today, last_discovery_date")
    .eq("discovery_enabled", true);

  if (error) {
    logger.error({ error }, "Failed to load brand discovery counts");
    return;
  }

  for (const brand of brands ?? []) {
    if (brand.last_discovery_date === today) {
      brandDiscoveryCounts.set(brand.id, {
        count: brand.discovery_count_today ?? 0,
        date: today,
      });
    }
  }

  logger.info(
    { brandsLoaded: brands?.length },
    "Brand discovery counts initialized",
  );
}

/* =========================================================
   MAIN LOOP
========================================================= */

export async function startDiscoveryScheduler() {
  if (isRunning) return;
  isRunning = true;

  await initializeBrandDiscoveryCounts();

  logger.info("Discovery scheduler started");

  while (isRunning) {
    try {
      const sources = await claimDiscoverySources(CLAIM_BATCH_SIZE);

      if (!sources?.length) {
        logger.debug("No sources claimed, waiting...");
        await sleep(LOOP_INTERVAL_MS);
        continue;
      }

      const limited = sources.slice(0, MAX_CONCURRENT_EXECUTIONS);

      logger.info(
        { claimed: sources.length, toExecute: limited.length, sources: limited.map(s => ({ id: s.id, type: s.type, brand_id: s.brand_id })) },
        "Sources claimed"
      );

      await Promise.all(limited.map(processSource));
    } catch (error: any) {
      logger.error({ error: error?.message }, "Scheduler loop error");

      await sleep(LOOP_INTERVAL_MS);
    }
  }
}

export function stopDiscoveryScheduler() {
  isRunning = false;
}
