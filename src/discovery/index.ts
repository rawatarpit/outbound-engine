import pino from "pino"
import { startDiscoveryScheduler, stopDiscoveryScheduler } from "./scheduler"
import { startDiscoveryProcessor, stopDiscoveryProcessor } from "./processor"

const logger = pino({ level: "debug" })

let shuttingDown = false

export async function startDiscoverySystem() {
  console.error("[DISCOVERY] Starting discovery system")
  console.error("[DISCOVERY] System will fetch discovery sources from DB and process them continuously")

  await Promise.all([
    startDiscoveryScheduler(),
    startDiscoveryProcessor()
  ])

  console.error("[DISCOVERY] Discovery scheduler and processor started")
}

// Start if run directly
startDiscoverySystem().catch((err) => {
  logger.fatal({ err }, "Discovery system failed to start")
  process.exit(1)
})

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
