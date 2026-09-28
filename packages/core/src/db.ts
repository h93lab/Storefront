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
      max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
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
