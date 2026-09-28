import fs from "node:fs/promises"
import { testConnection } from "./ai"
import { db } from "./db"
import { env } from "./env"
import { downloadImage } from "./media"
import { aiConfigured, getSettings } from "./settings"
import { parseStoreUrl, storeClient, type AppRef } from "./stores"
import { withTimeout } from "./stores/http"

export interface Check {
  name: string
  status: "ok" | "warn" | "fail" | "skip"
  detail: string
  ms: number
}

async function timed(name: string, fn: () => Promise<{ status?: Check["status"]; detail: string }>): Promise<Check> {
  const t = Date.now()
  try {
    const r = await withTimeout(fn(), 60_000, name)
    return { name, status: r.status ?? "ok", detail: r.detail, ms: Date.now() - t }
  } catch (e) {
    return { name, status: "fail", detail: (e as Error).message, ms: Date.now() - t }
  }
}

const IOS_SAMPLE: AppRef = { store: "ios", storeId: "571800810", country: "us", lang: "en" } // Calm
const ANDROID_SAMPLE: AppRef = { store: "android", storeId: "com.calm.android", country: "us", lang: "en" }

export async function workerHeartbeat() {
  const [row] = await db()<{ value: { at: string; concurrency: number } }[]>`select value from settings where key = 'worker'`
  return row?.value ?? null
}

/**
 * Checks every dependency the platform relies on. Pass a store link to test
 * that specific app instead of the built-in samples.
 */
export async function runDiagnostics(link?: string): Promise<Check[]> {
  const parsed = link ? parseStoreUrl(link) : null
  const target = (store: "ios" | "android"): AppRef =>
    parsed && parsed.store === store
      ? { store, storeId: parsed.storeId, country: parsed.country ?? "us", lang: parsed.lang ?? "en" }
      : store === "ios"
        ? IOS_SAMPLE
        : ANDROID_SAMPLE
  const checks: Check[] = []

  checks.push(
    await timed("Database round trip", async () => {
      const sql = db()
      await sql`select 1`
      const times: number[] = []
      for (let i = 0; i < 3; i++) {
        const t = Date.now()
        await sql`select 1`
        times.push(Date.now() - t)
      }
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      return avg > 120
        ? { status: "warn", detail: `${avg} ms per query. Pages will feel slow; a Supabase region closer to your server helps most.` }
        : { detail: `${avg} ms per query` }
    }),
  )

  checks.push(
    await timed("Worker", async () => {
      const hb = await workerHeartbeat()
      if (!hb) return { status: "fail", detail: "The worker has never reported in. Is the worker container running?" }
      const age = Date.now() - new Date(hb.at).getTime()
      const [{ stuck }] = await db()<{ stuck: number }[]>`
        select count(*)::int as stuck from jobs where status = 'running' and started_at < now() - interval '20 minutes'`
      if (age > 3 * 60_000)
        return { status: "fail", detail: `Last seen ${Math.round(age / 60_000)} minutes ago. Check \`docker compose logs worker\`.` }
      if (stuck) return { status: "warn", detail: `Running, but ${stuck} job(s) have been running for over 20 minutes.` }
      return { detail: `Running (${hb.concurrency} jobs at a time), last seen ${Math.round(age / 1000)}s ago` }
    }),
  )

  checks.push(
    await timed("Image storage", async () => {
      await fs.mkdir(env.mediaDir, { recursive: true })
      const probe = `${env.mediaDir}/.write-test`
      await fs.writeFile(probe, "ok")
      await fs.rm(probe)
      const s = await fs.statfs(env.mediaDir)
      const freeGb = (s.bavail * s.bsize) / 1e9
      return freeGb < 2
        ? { status: "warn", detail: `Writable, but only ${freeGb.toFixed(1)} GB free` }
        : { detail: `Writable, ${freeGb.toFixed(0)} GB free` }
    }),
  )

  const ios = target("ios")
  let iconUrl: string | null = null
  checks.push(
    await timed(`App Store listing (${ios.storeId}, ${ios.country.toUpperCase()})`, async () => {
      const l = await storeClient("ios").listing(ios)
      iconUrl = l.iconUrl
      return { detail: `${l.name} · ${l.screenshots.length} screenshots` }
    }),
  )
  checks.push(
    await timed("App Store reviews", async () => {
      const notes: string[] = []
      const r = await storeClient("ios").reviews(ios, 20, { note: (n) => notes.push(n) })
      return { status: r.length ? "ok" : "warn", detail: `${r.length} reviews. ${notes.join(" · ")}` }
    }),
  )
  checks.push(
    await timed("Image download", async () => {
      if (!iconUrl) return { status: "skip", detail: "Skipped: no App Store listing" }
      const b = await downloadImage(iconUrl)
      return { detail: `${Math.round(b.length / 1024)} KB` }
    }),
  )

  const android = target("android")
  checks.push(
    await timed(`Google Play listing (${android.storeId}, ${android.country.toUpperCase()})`, async () => {
      const l = await storeClient("android").listing(android)
      return { detail: `${l.name} · ${l.screenshots.length} screenshots` }
    }),
  )
  checks.push(
    await timed("Google Play reviews", async () => {
      const r = await storeClient("android").reviews(android, 20)
      return { status: r.length ? "ok" : "warn", detail: `${r.length} reviews in "${android.lang}"` }
    }),
  )

  const settings = await getSettings().catch(() => null)
  checks.push(
    await timed("AI provider", async () => {
      if (!settings || !aiConfigured(settings)) return { status: "skip", detail: "Not configured" }
      const r = await testConnection(settings.ai)
      return { detail: `${settings.ai.model} answered in ${r.ms} ms` }
    }),
  )
  return checks
}
