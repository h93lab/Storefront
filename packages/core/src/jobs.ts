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
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
}

/** Queues a job unless an identical one is already queued or running. */
export async function enqueue(type: JobType, payload: Record<string, unknown> = {}) {
  const sql = db()
  const [existing] = await sql<{ id: string }[]>`
    select id::text from jobs where type = ${type} and payload = ${sql.json(payload as never)} and status in ('queued', 'running') limit 1`
  if (existing) return existing.id
  const [row] = await sql<{ id: string }[]>`
    insert into jobs (type, payload) values (${type}, ${sql.json(payload as never)}) returning id::text`
  return row.id
}

export async function claimJob(): Promise<Job | null> {
  const [job] = await db()<Job[]>`
    update jobs set status = 'running', started_at = now(), attempts = attempts + 1
    where id = (select id from jobs where status = 'queued' order by id for update skip locked limit 1)
    returning id::text, type, payload, status, result, error, attempts, created_at, started_at, finished_at`
  return job ?? null
}

export async function finishJob(id: string, result: string) {
  await db()`update jobs set status = 'succeeded', result = ${result}, finished_at = now() where id = ${id}`
}

export async function failJob(id: string, error: string) {
  await db()`update jobs set status = 'failed', error = ${error.slice(0, 2000)}, finished_at = now() where id = ${id}`
}

/** Jobs left 'running' by a crashed worker go back to the queue. */
export async function requeueStale(minutes = 30) {
  await db()`update jobs set status = 'queued' where status = 'running' and started_at < now() - make_interval(mins => ${minutes})`
}

export async function recentJobs(limit = 20) {
  return db()<Job[]>`
    select id::text, type, payload, status, result, error, attempts, created_at, started_at, finished_at
    from jobs order by id desc limit ${limit}`
}

export async function pendingJobsFor(appId: string) {
  return db()<{ type: JobType; status: string }[]>`
    select type, status from jobs where status in ('queued', 'running') and payload->>'appId' = ${appId}`
}
