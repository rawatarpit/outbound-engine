import pino from "pino"
import { startDiscoveryScheduler, stopDiscoveryScheduler } from "./scheduler"
import { startDiscoveryProcessor, stopDiscoveryProcessor } from "./processor"

const logger = pino({ level: "info" })

let shuttingDown = false

export async function startDiscoverySystem() {
  logger.info("Starting discovery system")

  await Promise.all([
    startDiscoveryScheduler(),
    startDiscoveryProcessor()
  ])
}

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true

  logger.info("Graceful shutdown initiated")

  stopDiscoveryScheduler()
  stopDiscoveryProcessor()

  setTimeout(() => {
    logger.info("Shutdown complete")
    process.exit(0)
  }, 2000)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
process.on("uncaughtException", async (err) => {
  logger.fatal({ err }, "Uncaught exception")
  await shutdown()
})
process.on("unhandledRejection", async (err) => {
  logger.fatal({ err }, "Unhandled rejection")
  await shutdown()
})
