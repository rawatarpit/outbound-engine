import pino from "pino";
import { z } from "zod";
import type { DiscoveryResult } from "./types";

/* =========================================================
   RISK CLASSIFICATION
========================================================= */

export type DiscoveryRisk = "low_api" | "medium_api" | "high_scrape" | "static";

/* =========================================================
   COST CATEGORY
========================================================= */

export type CostCategory = "low" | "medium" | "high";

/* =========================================================
   EXECUTION CONTRACT
========================================================= */

export interface ExecutorParams<TConfig = unknown> {
  sourceId: string;
  brandId: string;
  config: TConfig;
}

export type Executor<TConfig = unknown> = (
  params: ExecutorParams<TConfig>,
) => Promise<DiscoveryResult>;

/* =========================================================
   REGISTERED EXECUTOR DEFINITION
========================================================= */

export interface RegisteredExecutor<TConfig = unknown> {
  type: string;
  risk: DiscoveryRisk;
  cost: CostCategory;
  requiresAuth: boolean;
  requiresInputAgent?: boolean;
  schema: z.ZodSchema<TConfig>;
  execute: Executor<TConfig>;
}

/* =========================================================
   LOGGER
========================================================= */

const logger = pino({ level: "info" });

/* =========================================================
   INTERNAL REGISTRY
========================================================= */

const registry = new Map<string, RegisteredExecutor<any>>();

/* =========================================================
   REGISTER EXECUTOR
========================================================= */

export function registerExecutor<TConfig>(def: RegisteredExecutor<TConfig>) {
  const key = def.type?.toLowerCase();

  if (!key) {
    throw new Error("Executor type cannot be empty");
  }

  if (registry.has(key)) {
    throw new Error(`Executor "${key}" already registered`);
  }

  registry.set(key, def);

  logger.info(
    {
      executor: key,
      risk: def.risk,
      cost: def.cost,
      requiresAuth: def.requiresAuth,
    },
    "Discovery executor registered",
  );
}

/* =========================================================
   GET EXECUTOR
========================================================= */

export function getExecutor(type: string): RegisteredExecutor<any> | null {
  if (!type) return null;
  return registry.get(type.toLowerCase()) ?? null;
}

/* =========================================================
   LIST EXECUTORS
========================================================= */

export function listExecutors(): RegisteredExecutor<any>[] {
  return Array.from(registry.values());
}

/* =========================================================
   VALIDATION (RECOMMENDED HARDENING)
========================================================= */

export function assertExecutorExists(type: string) {
  const exists = registry.has(type.toLowerCase());
  if (!exists) {
    throw new Error(`Executor not registered: ${type}`);
  }
}

/* =========================================================
   BUILT-IN EXECUTOR REGISTRATION
========================================================= */

/* ---- IMPORT EXECUTORS + SCHEMAS ---- */

import { githubExecutor } from "./executors/github/executor";
import { githubSchema } from "./executors/github/schema";

import { hunterExecutor } from "./executors/hunter/executor";
import { hunterSchema } from "./executors/hunter/schema";

import { apolloExecutor } from "./executors/apollo/executor";
import { apolloSchema } from "./executors/apollo/schema";

import { productHuntExecutor } from "./executors/producthunt/executor";
import { productHuntSchema } from "./executors/producthunt/schema";

import { indieHackersExecutor } from "./executors/indiehackers/executor";
import { indieHackersSchema } from "./executors/indiehackers/schema";

import { csvExecutor } from "./executors/csv/executor";
import { csvSchema } from "./executors/csv/schema";

import { urlScraperExecutor } from "./executors/urlScraper/executor";
import { urlScraperSchema } from "./executors/urlScraper/schema";

/* ---- REDDIT (MISSING BEFORE) ---- */

import { redditExecutor } from "./executors/reddit/executor";
import { redditSchema } from "./executors/reddit/schema";

/* -------- LOW COST / LOW RISK API -------- */

registerExecutor({
  type: "github",
  risk: "low_api",
  cost: "low",
  requiresAuth: false,
  schema: githubSchema,
  execute: githubExecutor,
});

registerExecutor({
  type: "producthunt",
  risk: "low_api",
  cost: "low",
  requiresAuth: false,
  schema: productHuntSchema,
  execute: productHuntExecutor,
});

/* -------- MEDIUM API -------- */

registerExecutor({
  type: "hunter",
  risk: "medium_api",
  cost: "medium",
  requiresAuth: true,
  schema: hunterSchema,
  execute: hunterExecutor,
});

registerExecutor({
  type: "indiehackers",
  risk: "medium_api",
  cost: "low",
  requiresAuth: false,
  schema: indieHackersSchema,
  execute: indieHackersExecutor,
});

/* -------- HIGH COST API -------- */

registerExecutor({
  type: "apollo",
  risk: "medium_api",
  cost: "high",
  requiresAuth: true,
  schema: apolloSchema,
  execute: apolloExecutor,
});

/* -------- REDDIT (MEDIUM SCRAPE/API) -------- */

registerExecutor({
  type: "reddit",
  risk: "medium_api", // change to "high_scrape" if scraping
  cost: "low",
  requiresAuth: false,
  schema: redditSchema,
  execute: redditExecutor,
});

/* -------- STATIC SOURCE -------- */

registerExecutor({
  type: "csv",
  risk: "static",
  cost: "low",
  requiresAuth: false,
  schema: csvSchema,
  execute: csvExecutor,
});

/* -------- URL SCRAPER -------- */

registerExecutor({
  type: "url_scraper",
  risk: "high_scrape",
  cost: "low",
  requiresAuth: false,
  schema: urlScraperSchema,
  execute: urlScraperExecutor,
});
