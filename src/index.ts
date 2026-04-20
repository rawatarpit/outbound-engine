import dotenv from "dotenv";
dotenv.config();

import pino from "pino";
import cron, { ScheduledTask } from "node-cron";

import { testConnection, getRunnableBrands } from "./db/supabase";
import { startIMAPMonitor, stopIMAPMonitor } from "./email/imap";
import { processSendQueue } from "./queue/sendProcessor";
import { validateEnv } from "./config/env";
import { isAutomationEnabled } from "./system/flags";
import { loadBreakerState } from "./reputation/circuitBreaker";

import { startStateMachine } from "./orchestrator/stateMachine";
import {
  startDiscoveryScheduler,
  stopDiscoveryScheduler,
} from "./discovery/scheduler";
import {
  startDiscoveryProcessor,
  stopDiscoveryProcessor,
} from "./discovery/processor";
import { runEnrichmentWorker } from "./enrichment/worker";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

let sendQueueRunning = false;
let enrichmentRunning = false;
let shuttingDown = false;

let sendCron: ScheduledTask | null = null;
let enrichmentCron: ScheduledTask | null = null;

/* =========================================================
   GLOBAL ERROR HANDLING
========================================================= */

process.on("unhandledRejection", (reason: any) => {
  logger.error({ reason }, "Unhandled Rejection");
});

process.on("uncaughtException", (err: any) => {
  logger.fatal({ err }, "Uncaught Exception");
  process.exit(1);
});

/* =========================================================
   SAFE CRON WRAPPER
========================================================= */

async function safeRun(
  flag: () => boolean,
  setFlag: (v: boolean) => void,
  fn: () => Promise<void>,
  label: string,
) {
  if (flag()) {
    logger.warn(`Skipping overlapping job: ${label}`);
    return;
  }

  try {
    setFlag(true);
    await fn();
  } catch (err: any) {
    logger.error({ err }, `${label} failed`);
  } finally {
    setFlag(false);
  }
}

/* =========================================================
   SEND QUEUE LOOP
========================================================= */

async function processAllBrandsSendQueue() {
  const brands = await getRunnableBrands();

  if (!brands.length) return;

  for (const brand of brands) {
    await processSendQueue(brand.id);
  }
}

/* =========================================================
    BOOTSTRAP
========================================================== */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootstrap() {
  logger.info("Starting Outbound Engine");

  validateEnv();
  await testConnection();
  await loadBreakerState();

/* -----------------------------
      Core Pipelines (start immediately)
   ------------------------------ */

  startStateMachine();
  await Promise.all([
    startDiscoveryScheduler(),
    startDiscoveryProcessor(),
  ]);

  /* -----------------------------
     Enrichment Cron (Every 1 min) - start after 30s delay to prevent DB spike
  ------------------------------ */

  await sleep(30000);

  enrichmentCron = cron.schedule("*/1 * * * *", async () => {
    if (shuttingDown) return;

    await safeRun(
      () => enrichmentRunning,
      (v) => (enrichmentRunning = v),
      async () => {
        await runEnrichmentWorker();
      },
      "EnrichmentWorker",
    );
  });

  /* -----------------------------
      Send Cron (Every 2 mins) - start after 60s delay to prevent DB spike
   ------------------------------ */

  await sleep(60000);

  sendCron = cron.schedule("*/2 * * * *", async () => {
    if (shuttingDown) return;

    try {
      const enabled = await isAutomationEnabled();

      if (!enabled) return;

      await safeRun(
        () => sendQueueRunning,
        (v) => (sendQueueRunning = v),
        async () => {
          await processAllBrandsSendQueue();
        },
        "SendQueue",
      );
    } catch (err: any) {
      logger.error({ err }, "Send cron error");
    }
  });

  /* -----------------------------
      IMAP
   ------------------------------ */

  startIMAPMonitor().catch((err) => {
    logger.error({ err }, "IMAP monitor crashed");
  });

  logger.info("System fully operational");
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Bootstrap failed");
  process.exit(1);
});

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}. Shutting down...`);

  try {
    if (sendCron) sendCron.stop();
    if (enrichmentCron) enrichmentCron.stop();

    stopDiscoveryScheduler();
    stopDiscoveryProcessor();

    await stopIMAPMonitor();

    logger.info("Graceful shutdown complete");
  } catch (err: any) {
    logger.error({ err }, "Shutdown error");
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
