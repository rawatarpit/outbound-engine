import axios from "axios"
import pino from "pino"

const logger = pino({ level: "info" })

const APIFY_BASE = "https://api.apify.com/v2"
const MAX_POLL_ATTEMPTS = 60
const POLL_INTERVAL_MS = 2000
const DATASET_LIMIT = 100 // make configurable later

export async function runApifyActor<TInput, TOutput>(
  actorId: string,
  input: TInput,
  token: string
): Promise<TOutput[]> {
  try {
    const runRes = await axios.post(
      `${APIFY_BASE}/acts/${actorId}/runs`,
      input,
      {
        params: { token },
        timeout: 60000
      }
    )

    const runId = runRes.data.data.id

    const finalRun = await waitForRun(runId, token)

    const datasetId = finalRun.defaultDatasetId

    if (!datasetId) {
      throw new Error("Apify run completed without dataset")
    }

    const itemsRes = await axios.get(
      `${APIFY_BASE}/datasets/${datasetId}/items`,
      {
        params: { token, limit: DATASET_LIMIT },
        timeout: 30000
      }
    )

    return itemsRes.data as TOutput[]
  } catch (err: any) {
    logger.error({ err: err?.message }, "Apify actor failed")
    throw err
  }
}

async function waitForRun(runId: string, token: string) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    try {
      const res = await axios.get(
        `${APIFY_BASE}/actor-runs/${runId}`,
        { params: { token }, timeout: 10000 }
      )

      const run = res.data.data
      const status = run.status

      if (status === "SUCCEEDED") return run
      if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
        throw new Error(`Apify run ended with status ${status}`)
      }

    } catch (err) {
      logger.warn("Transient polling error, retrying...")
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }

  throw new Error("Apify run timeout")
}