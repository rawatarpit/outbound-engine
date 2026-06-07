import pino from "pino";
import { supabase } from "../db/supabase";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

type FlagCache = {
  value: boolean;
  fetchedAt: number;
};

const CACHE_TTL_MS = 10_000; // 10 seconds cache
const cache: Record<string, FlagCache> = {};

/**
 * ==========================================
 * Fetch Flag From Supabase
 * ==========================================
 */
async function fetchFlag(key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("system_flags")
      .select("value")
      .eq("key", key)
      .single();

    if (error) {
      logger.error({ error }, `Failed to fetch system flag: ${key}`);
      return false; // fail-closed for safety
    }

    if (!data) {
      logger.warn(
        `System flag not found: ${key}, defaulting to false (fail-closed)`,
      );
      return false;
    }

    return Boolean(data.value);
  } catch (err: any) {
    logger.error({ err }, `Unexpected error fetching flag: ${key}`);
    return false; // fail-closed for safety
  }
}

/**
 * ==========================================
 * Get Flag With Cache
 * ==========================================
 */
export async function getFlag(key: string): Promise<boolean> {
  const now = Date.now();

  const cached = cache[key];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const value = await fetchFlag(key);

  cache[key] = {
    value,
    fetchedAt: now,
  };

  return value;
}

/**
 * ==========================================
 * Public Flag Helpers
 * ==========================================
 */

export async function isAutomationEnabled(): Promise<boolean> {
  return getFlag("automation_enabled");
}

export async function isSendEnabled(): Promise<boolean> {
  return getFlag("send_enabled");
}

export async function isImapEnabled(): Promise<boolean> {
  return getFlag("imap_enabled");
}

/**
 * ==========================================
 * Manual Cache Reset (optional)
 * ==========================================
 */
export function clearFlagCache() {
  Object.keys(cache).forEach((key) => delete cache[key]);
}
