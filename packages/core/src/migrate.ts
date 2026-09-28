import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { db } from "./db"

function migrationsDir() {
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR)
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../db/migrations")
}

/** Applies every db/migrations/*.sql file once, in name order, under an advisory lock. */
export async function migrate(log: (msg: string) => void = console.log) {
  const sql = db()
  const dir = migrationsDir()
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort()
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(724301)`
    await tx`create table if not exists _lens_migrations (name text primary key, applied_at timestamptz not null default now())`
    const done = new Set((await tx<{ name: string }[]>`select name from _lens_migrations`).map((r) => r.name))
    for (const file of files) {
      if (done.has(file)) continue
      const body = await fs.readFile(path.join(dir, file), "utf8")
      await tx.unsafe(body)
      await tx`insert into _lens_migrations (name) values (${file})`
      log(`applied migration ${file}`)
    }
  })
}
