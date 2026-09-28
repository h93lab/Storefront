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
  requeueStale,
  syncApp,
  type Job,
} from "@lens/core"
import { migrate } from "@lens/core/migrate"

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000)
const log = (msg: string, extra?: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }))

let stopping = false
let schedule: Cron | null = null
let scheduleExpr = ""

async function run(job: Job): Promise<string> {
  const appId = String(job.payload.appId ?? "")
  switch (job.type) {
    case "sync_all": {
      const apps = await db()<{ id: string }[]>`select id from apps order by created_at`
      for (const a of apps) await enqueue("sync_app", { appId: a.id })
      return `Queued ${apps.length} app${apps.length === 1 ? "" : "s"}`
    }
    case "sync_app": {
      const r = await syncApp(appId, { log: (m) => log(m, { job: job.id, appId }) })
      const settings = await getSettings()
      if (aiConfigured(settings) && settings.ai.autoAnalyse && (r.newReviews > 0 || !(await getInsights(appId)))) {
        await enqueue("analyse_app", { appId })
      }
      const parts = [`${r.newReviews} new reviews`, `${r.screenshots} screenshots (${r.newScreenshots} new)`]
      if (r.changes.length) parts.push(`changes: ${r.changes.join("; ")}`)
      if (r.warnings.length) parts.push(`warnings: ${r.warnings.join("; ")}`)
      return `${r.name}: ${parts.join(" · ")}`
    }
    case "analyse_app": {
      const r = await analyseApp(appId, { log: (m) => log(m, { job: job.id, appId }) })
      return `${r.classified} reviews classified · insights from ${r.reviewsCount} reviews`
    }
    default:
      throw new Error(`Unknown job type ${job.type}`)
  }
}

async function loop() {
  while (!stopping) {
    let job: Job | null = null
    try {
      job = await claimJob()
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        continue
      }
      log("job started", { job: job.id, type: job.type, payload: job.payload })
      const result = await run(job)
      await finishJob(job.id, result)
      log("job finished", { job: job.id, result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log("job failed", { job: job?.id, error: message })
      if (job) await failJob(job.id, message).catch(() => {})
      else await new Promise((r) => setTimeout(r, POLL_MS * 3)) // database hiccup
    }
  }
}

/** Keeps the cron schedule in step with the value saved in Settings. */
async function refreshSchedule() {
  try {
    const { sync } = await getSettings()
    if (sync.cron === scheduleExpr) return
    schedule?.stop()
    schedule = new Cron(sync.cron, { timezone: env.timezone, protect: true }, async () => {
      log("scheduled sync")
      await enqueue("sync_all")
    })
    scheduleExpr = sync.cron
    log("schedule set", { cron: sync.cron, timezone: env.timezone, next: schedule.nextRun()?.toISOString() })
  } catch (e) {
    log("invalid schedule, keeping previous", { error: (e as Error).message })
  }
}

async function main() {
  log("worker starting", { mediaDir: env.mediaDir })
  await migrate((m) => log(m))
  await requeueStale()
  await refreshSchedule()
  const timer = setInterval(refreshSchedule, 60_000)
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
  await loop()
  await closeDb()
}

main().catch((e) => {
  log("worker crashed", { error: e instanceof Error ? e.stack : String(e) })
  process.exit(1)
})
