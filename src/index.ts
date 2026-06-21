import dotenv from "dotenv";
dotenv.config();

import pino from "pino";

import { testConnection } from "./db/supabase";
import { startIMAPMonitor, stopIMAPMonitor } from "./email/imap";
import { validateEnv } from "./config/env";
import { loadBreakerState } from "./reputation/circuitBreaker";

import { startAPIServer } from "./api/server";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

let shuttingDown = false;

process.on("unhandledRejection", (reason: any) => {
  logger.error({ reason }, "Unhandled Rejection");
});

process.on("uncaughtException", (err: any) => {
  logger.fatal({ err }, "Uncaught Exception");
  process.exit(1);
});

async function bootstrap() {
  logger.info("Starting Outbound Engine (chat-only mode)");

  validateEnv();
  await testConnection();
  await loadBreakerState();

  startAPIServer().catch((err) => {
    logger.error({ err }, "API server failed to start");
  });

  startIMAPMonitor().catch((err) => {
    logger.error({ err }, "IMAP monitor crashed");
  });

  logger.info("Chat agent ready — waiting for requests");
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Bootstrap failed");
  process.exit(1);
});

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}. Shutting down...`);

  try {
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
