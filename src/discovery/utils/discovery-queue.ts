import fs from "fs"
import path from "path"
import pino from "pino"

const logger = pino({ name: "discovery-queue" })
const QUEUE_FILE = path.resolve(process.cwd(), "data", "discovery-queue.json")

interface QueueJob {
  id: string
  type: "signal_discovery" | "contact_discovery" | "url_scrape"
  brandId?: string
  intentId?: string
  companyId?: string
  domain?: string
  companyName?: string
  url?: string
  clientId?: string
  status: "pending" | "processing" | "completed" | "failed"
  createdAt: number
  startedAt?: number
  completedAt?: number
  error?: string
  retries: number
  maxRetries: number
}

function loadJobs(): QueueJob[] {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"))
    }
  } catch { /* ignore */ }
  return []
}

function saveJobs(jobs: QueueJob[]): void {
  const dir = path.dirname(QUEUE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(jobs, null, 2))
}

export function enqueue(job: Omit<QueueJob, "id" | "status" | "createdAt" | "retries" | "maxRetries">): string {
  const jobs = loadJobs()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  jobs.push({
    ...job,
    id,
    status: "pending",
    createdAt: Date.now(),
    retries: 0,
    maxRetries: 3,
  })
  saveJobs(jobs)
  logger.info({ jobId: id, type: job.type }, "Job enqueued")
  return id
}

export function dequeue(): QueueJob | null {
  const jobs = loadJobs()
  const idx = jobs.findIndex(j => j.status === "pending")
  if (idx === -1) return null
  jobs[idx].status = "processing"
  jobs[idx].startedAt = Date.now()
  saveJobs(jobs)
  return jobs[idx]
}

export function complete(jobId: string): void {
  const jobs = loadJobs()
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  job.status = "completed"
  job.completedAt = Date.now()
  saveJobs(jobs)
  logger.info({ jobId }, "Job completed")
}

export function fail(jobId: string, error: string): void {
  const jobs = loadJobs()
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  job.retries++
  if (job.retries >= job.maxRetries) {
    job.status = "failed"
    logger.error({ jobId, error, retries: job.retries }, "Job failed permanently")
  } else {
    job.status = "pending"
    logger.warn({ jobId, error, retries: job.retries }, "Job will be retried")
  }
  job.error = error
  job.completedAt = Date.now()
  saveJobs(jobs)
}

export function getPendingCount(): number {
  return loadJobs().filter(j => j.status === "pending").length
}

export function getQueueStatus(): { pending: number; processing: number; completed: number; failed: number } {
  const jobs = loadJobs()
  return {
    pending: jobs.filter(j => j.status === "pending").length,
    processing: jobs.filter(j => j.status === "processing").length,
    completed: jobs.filter(j => j.status === "completed").length,
    failed: jobs.filter(j => j.status === "failed").length,
  }
}
