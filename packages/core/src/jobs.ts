import { db } from "./db"

export type JobType = "sync_app" | "sync_all" | "analyse_app"

export interface Job {
  id: string
  type: JobType
  payload: Record<string, unknown>
  status: "queued" | "running" | "succeeded" | "failed"
  result: string | null
  error: string | null
  attempts: number
  progress: string | null
  run_after: Date
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
}

/**
 * Queues a job unless an identical one is already waiting. A job that is
 * currently running does not count: new work that arrives mid-run gets its own turn.
 */
export async function enqueue(type: JobType, payload: Record<string, unknown> = {}) {
  const sql = db()
  const [existing] = await sql<{ id: string }[]>`
    select id::text from jobs where type = ${type} and payload = ${sql.json(payload as never)} and status = 'queued' limit 1`
  if (existing) return existing.id
  const [row] = await sql<{ id: string }[]>`
    insert into jobs (type, payload) values (${type}, ${sql.json(payload as never)}) returning id::text`
  return row.id
}

const JOB_COLS = "id::text, type, payload, status, result, error, attempts, progress, run_after, created_at, started_at, finished_at"

/**
 * Claims the oldest job that is due. Jobs for an app that already has a
 * running job wait, so two workers never sync the same app at once.
 */
export async function claimJob(): Promise<Job | null> {
  const sql = db()
  const [job] = await sql<Job[]>`
    update jobs set status = 'running', started_at = now(), attempts = attempts + 1, progress = null
    where id = (
      select q.id from jobs q
      where q.status = 'queued' and q.run_after <= now()
        and not (q.payload ? 'appId' and exists (
          select 1 from jobs r where r.status = 'running' and r.payload->>'appId' = q.payload->>'appId'))
      order by q.id for update skip locked limit 1)
    returning ${sql.unsafe(JOB_COLS)}`
  return job ?? null
}

export async function setJobProgress(id: string, progress: string) {
  await db()`update jobs set progress = ${progress.slice(0, 300)} where id = ${id} and status = 'running'`
}

export async function finishJob(id: string, result: string) {
  await db()`update jobs set status = 'succeeded', result = ${result}, progress = null, finished_at = now() where id = ${id}`
}

export async function failJob(id: string, error: string) {
  await db()`update jobs set status = 'failed', error = ${error.slice(0, 2000)}, progress = null, finished_at = now() where id = ${id}`
}

/** Puts a job back in the queue to run again after `delayMs`. */
export async function retryJob(id: string, error: string, delayMs: number) {
  await db()`update jobs set status = 'queued', error = ${error.slice(0, 2000)}, progress = null,
    run_after = now() + make_interval(secs => ${Math.round(delayMs / 1000)}) where id = ${id}`
}

/** Network-level failures worth retrying (as opposed to "app not found"). */
export const isTransient = (message: string) =>
  /timed out|timeout|HTTP (408|425|429|5\d\d)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up|network/i.test(
    message,
  )

export const MAX_ATTEMPTS = 3

/**
 * Jobs left 'running' by a stopped or crashed worker go back to the queue, or
 * fail after MAX_ATTEMPTS. Pass minutes = 0 at worker startup (a single worker
 * owns the queue, so anything still 'running' then was interrupted).
 */
export async function requeueStale(minutes = 30) {
  const sql = db()
  const cutoff = sql`started_at <= now() - make_interval(mins => ${minutes})`
  await sql`update jobs set status = 'failed', finished_at = now(), error = 'Interrupted too many times'
    where status = 'running' and attempts >= ${MAX_ATTEMPTS} and ${cutoff}`
  const requeued = await sql`update jobs set status = 'queued' where status = 'running' and ${cutoff} returning id`
  // Apps whose sync was interrupted should not look busy forever.
  await sql`update apps set status = case when last_synced_at is null then 'pending' else 'ready' end
    where status = 'syncing' and not exists (select 1 from jobs where status = 'running' and type = 'sync_app' and payload->>'appId' = apps.id::text)`
  return requeued.length
}

export async function recentJobs(limit = 20) {
  const sql = db()
  return sql<Job[]>`select ${sql.unsafe(JOB_COLS)} from jobs order by id desc limit ${limit}`
}

export interface ActiveJob {
  id: string
  type: JobType
  status: "queued" | "running"
  app_id: string | null
  progress: string | null
  error: string | null
  run_after: Date
}

/** Queued and running jobs, optionally for one app. Cheap enough to poll. */
export async function activeJobs(appId?: string) {
  return db()<ActiveJob[]>`
    select id::text, type, status, payload->>'appId' as app_id, progress, error, run_after
    from jobs where status in ('queued', 'running')
      and (${appId ?? null}::text is null or payload->>'appId' = ${appId ?? ""})
    order by id`
}

export async function pendingJobsFor(appId: string) {
  return activeJobs(appId)
}
