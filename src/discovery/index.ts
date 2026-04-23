import pino from "pino"
import { startSignalScheduler, stopSignalScheduler } from "./signals/scheduler"

const logger = pino({ level: "debug" })

let shuttingDown = false

export async function startSignalDiscoverySystem() {
  console.error("[SIGNAL DISCOVERY] Starting signal-driven discovery system")
  console.error("[SIGNAL DISCOVERY] System will process brand intents and generate opportunities")

  await startSignalScheduler()

  console.error("[SIGNAL DISCOVERY] Signal discovery scheduler started")
}

startSignalDiscoverySystem().catch((err) => {
  logger.fatal({ err }, "Signal discovery system failed to start")
  process.exit(1)
})

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true

  logger.info("Graceful shutdown initiated")

  stopSignalScheduler()

  setTimeout(() => {
    logger.info("Shutdown complete")
    process.exit(0)
  }, 2000)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)