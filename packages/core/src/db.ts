import postgres from "postgres"
import { env } from "./env"

export type Sql = postgres.Sql

let client: Sql | undefined

function sslFor(url: string): postgres.Options<{}>["ssl"] {
  const mode = process.env.DATABASE_SSL
  if (mode === "disable") return false
  if (mode === "require") return "require"
  const host = new URL(url).hostname
  return ["localhost", "127.0.0.1", "db", "postgres"].includes(host) ? false : "require"
}

/** Shared connection pool. `prepare: false` keeps it compatible with the Supabase transaction pooler. */
export function db(): Sql {
  if (!client) {
    const url = env.databaseUrl
    client = postgres(url, {
      prepare: false,
      ssl: sslFor(url),
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idle_timeout: 20,
      onnotice: () => {},
    })
  }
  return client
}

export async function closeDb() {
  if (client) {
    await client.end({ timeout: 5 })
    client = undefined
  }
}

/** Waits until the database accepts connections (after a reboot the container can start first). */
export async function waitForDb(log: (msg: string) => void = console.log, timeoutMs = 120_000) {
  const started = Date.now()
  for (let attempt = 1; ; attempt++) {
    try {
      await db()`select 1`
      return
    } catch (e) {
      if (Date.now() - started > timeoutMs) throw e
      log(`database not reachable yet (${(e as Error).message}), retrying`)
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 10_000)))
    }
  }
}
