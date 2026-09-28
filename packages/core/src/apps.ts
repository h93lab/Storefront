import fs from "node:fs/promises"
import path from "node:path"
import { db } from "./db"
import { env } from "./env"
import { enqueue } from "./jobs"
import type { Store } from "./stores"

export interface AddAppInput {
  store: Store
  storeId: string
  country?: string
  lang?: string
}

/** Adds an app to the library (idempotent) and queues its first sync. */
export async function addApp(input: AddAppInput) {
  const country = (input.country ?? "us").toLowerCase()
  const lang = (input.lang ?? "en").toLowerCase()
  if (!/^[a-z]{2}$/.test(country)) throw new Error("Country must be a two-letter code such as US or EG")
  const sql = db()
  const [row] = await sql<{ id: string; created: boolean }[]>`
    insert into apps (store, store_id, country, lang) values (${input.store}, ${input.storeId}, ${country}, ${lang})
    on conflict (store, store_id, country) do update set lang = excluded.lang
    returning id, (xmax = 0) as created`
  await enqueue("sync_app", { appId: row.id })
  return row
}

/** Deletes an app with its reviews, screenshots, history and stored images. */
export async function removeApp(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid app id")
  await db()`delete from apps where id = ${id}`
  await fs.rm(path.join(env.mediaDir, id), { recursive: true, force: true })
}
