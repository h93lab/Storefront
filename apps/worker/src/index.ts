import { Cron } from "croner"
import {
  aiConfigured,
  analyseApp,
  claimJob,
  closeDb,
  db,
  enqueue,
  env,
  failJob,
  finishJob,
  getInsights,
  getSettings,
  isTransient,
  MAX_ATTEMPTS,
  requeueStale,
  retryJob,
  setJobProgress,
  syncApp,
  withTimeout,
  type Job,
} from "@lens/core"
import { migrate } from "@lens/core/migrate"

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000)
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2))
const JOB_TIMEOUT_MS = Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 15 * 60_000)
const log = (msg: string, extra?: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }))

let stopping = false
let schedule: Cron | null = null
let scheduleExpr = ""

/** Writes progress to the job row at most once a second, so the UI can show it. */
function progressWriter(jobId: string) {
  let last = 0
  let pending: string | null = null
  let timer: NodeJS.Timeout | null = null
  const flush = () => {
    timer = null
    if (pending == null) return
    const text = pending
    pending = null
    last = Date.now()
    setJobProgress(jobId, text).catch(() => {})
  }
  return (text: string) => {
    pending = text
    if (timer) return
    timer = setTimeout(flush, Math.max(0, 1000 - (Date.now() - last)))
  }
}

async function run(job: Job): Promise<string> {
  const appId = String(job.payload.appId ?? "")
  const onProgress = progressWriter(job.id)
  switch (job.type) {
    case "sync_all": {
      // Demo apps from `pnpm seed` are not in any store.
      const apps = await db()<{ id: string }[]>`select id from apps where store_id not like 'demo.%' order by created_at`
      for (const a of apps) await enqueue("sync_app", { appId: a.id })
      return `Queued ${apps.length} app${apps.length === 1 ? "" : "s"}`
    }
    case "sync_app": {
      const r = await syncApp(appId, { log: (m) => log(m, { job: job.id, appId }), onProgress })
      const settings = await getSettings()
      if (aiConfigured(settings) && settings.ai.autoAnalyse && (r.newReviews > 0 || !(await getInsights(appId)))) {
        await enqueue("analyse_app", { appId })
      }
      const parts = [
        `${r.reviewsFetched} reviews fetched (${r.newReviews} new)`,
        `${r.screenshots} screenshots (${r.newScreenshots} new)`,
        `${(r.durationMs / 1000).toFixed(1)}s`,
      ]
      if (r.changes.length) parts.push(`changes: ${r.changes.join("; ")}`)
      if (r.warnings.length) parts.push(`warnings: ${r.warnings.join("; ")}`)
      return `${r.name}: ${parts.join(" · ")}`
    }
    case "analyse_app": {
      const r = await analyseApp(appId, { log: (m) => log(m, { job: job.id, appId }), onProgress })
      return `${r.classified} reviews classified · insights from ${r.reviewsCount} reviews`
    }
    default:
      throw new Error(`Unknown job type ${job.type}`)
  }
}

async function loop(slot: number) {
  while (!stopping) {
    let job: Job | null = null
    try {
      job = await claimJob()
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        continue
      }
      log("job started", { slot, job: job.id, type: job.type, payload: job.payload, attempt: job.attempts })
      const result = await withTimeout(run(job), JOB_TIMEOUT_MS, "Job")
      await finishJob(job.id, result)
      log("job finished", { job: job.id, result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!job) {
        log("queue unavailable", { error: message })
        await new Promise((r) => setTimeout(r, POLL_MS * 3)) // database hiccup
        continue
      }
      if (isTransient(message) && job.attempts < MAX_ATTEMPTS) {
        const delay = 60_000 * 2 ** (job.attempts - 1)
        log("job failed, will retry", { job: job.id, error: message, retryInSec: delay / 1000 })
        await retryJob(job.id, message, delay).catch(() => {})
      } else {
        log("job failed", { job: job.id, error: message })
        await failJob(job.id, message).catch(() => {})
      }
    }
  }
}

/** Lets the Settings page and `pnpm doctor` see that the worker is alive. */
async function heartbeat() {
  await db()`insert into settings (key, value) values ('worker', ${db().json({ at: new Date().toISOString(), concurrency: CONCURRENCY })})
    on conflict (key) do update set value = excluded.value`.catch(() => {})
}

/** Keeps the cron schedule in step with the value saved in Settings. */
async function refreshSchedule() {
  try {
    const { sync } = await getSettings()
    if (sync.cron === scheduleExpr) return
    schedule?.stop()
    schedule = new Cron(
      sync.cron,
      { timezone: env.timezone, protect: true, catch: (e) => log("scheduled sync could not be queued", { error: String(e) }) },
      async () => {
        log("scheduled sync")
        await enqueue("sync_all")
      },
    )
    scheduleExpr = sync.cron
    log("schedule set", { cron: sync.cron, timezone: env.timezone, next: schedule.nextRun()?.toISOString() })
  } catch (e) {
    log("invalid schedule, keeping previous", { error: (e as Error).message })
  }
}

async function main() {
  log("worker starting", { mediaDir: env.mediaDir, concurrency: CONCURRENCY })
  await migrate((m) => log(m))
  const requeued = await requeueStale(0)
  if (requeued) log("requeued interrupted jobs", { count: requeued })
  await refreshSchedule()
  await heartbeat()
  const timer = setInterval(() => {
    refreshSchedule()
    heartbeat()
    requeueStale(30).catch((e) => log("requeue check failed", { error: String(e) }))
  }, 60_000)
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    clearInterval(timer)
    schedule?.stop()
    log("worker stopping")
    setTimeout(() => process.exit(0), 10_000).unref()
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => loop(i + 1)))
  await closeDb()
}

process.on("unhandledRejection", (e) => log("unhandled rejection", { error: e instanceof Error ? e.stack : String(e) }))

main().catch((e) => {
  log("worker crashed", { error: e instanceof Error ? e.stack : String(e) })
  process.exit(1)
})
