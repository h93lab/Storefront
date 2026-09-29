import http from "node:http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { StoreClient, StoreListing, StoreReview } from "../src/stores"

/**
 * End-to-end pipeline test against a real Postgres. Store and AI calls are
 * faked; everything else (SQL, media storage, diffing, aggregation) is real.
 * Run with TEST_DATABASE_URL=postgres://… (the database is wiped).
 */
const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

const png = (hue: number) =>
  sharp({ create: { width: 390, height: 844, channels: 3, background: { r: hue, g: 120, b: 255 - hue } } })
    .png()
    .toBuffer()

let listing: StoreListing
let reviews: StoreReview[]
const images = new Map<string, Promise<Buffer>>()
const fakeClient: StoreClient = {
  listing: async () => listing,
  reviews: async (_ref, max) => reviews.slice(0, max),
  search: async () => [],
}
const fetchImage = (u: string) => {
  if (u.endsWith("copy-of-3")) return fetchImage("https://img/shot-3")
  if (!images.has(u)) images.set(u, png(Number(u.match(/(\d+)$/)?.[1] ?? 1) * 20))
  return images.get(u)!
}

let aiServer: http.Server
let aiUrl = ""

suite("pipeline", () => {
  let core: typeof import("../src/index")
  let appId = ""

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    process.env.MEDIA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "lens-media-"))
    core = await import("../src/index")
    const sql = core.db()
    await sql.unsafe("drop schema public cascade; create schema public;")
    await (await import("../src/migrate")).migrate(() => {})

    // Fake OpenAI-compatible provider: classifies by rating, clusters by echoing.
    aiServer = http.createServer(async (req, res) => {
      let body = ""
      for await (const c of req) body += c
      const msgs = JSON.parse(body).messages as { role: string; content: string }[]
      let user: unknown
      try {
        user = JSON.parse(msgs[msgs.length - 1].content)
      } catch {
        user = null
      }
      let content: unknown
      if (user === null) {
        content = { ok: true }
      } else if (Array.isArray(user)) {
        content = {
          items: user.map((r: { id: string; rating: number; text: string }) => ({
            id: r.id,
            sentiment: r.rating >= 4 ? "positive" : r.rating === 3 ? "neutral" : "negative",
            topic: r.rating <= 2 ? "Pricing" : "Praise",
            kind: r.rating <= 2 ? "complaint" : r.rating === 3 ? "request" : "praise",
            label: r.rating <= 2 ? "Paywall before trying content" : "Arabic narration",
            wtp_signal: r.text.includes("Paywall hit") ? "churned" : "none",
            competitor: r.text.includes("Paywall hit") ? "Headspace" : null,
            workaround: null,
            // one verbatim quote, one paraphrase the normaliser must drop
            evidence: r.text.includes("Paywall hit") ? "Paywall hit immediately" : r.id === "r1" ? "not in the review" : null,
            pain: r.rating <= 2 ? 4 : 0,
          })),
        }
      } else {
        const u = user as { complaints: unknown; requests: unknown }
        content = { complaints: u.complaints, requests: u.requests, summary: "Offer a free sample before the paywall." }
      }
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))
    })
    await new Promise<void>((r) => aiServer.listen(0, r))
    aiUrl = `http://127.0.0.1:${(aiServer.address() as { port: number }).port}/v1`
  })

  afterAll(async () => {
    aiServer?.close()
    if (core) await core.closeDb()
  })

  it("adds an app idempotently and queues a sync job", async () => {
    const a = await core.addApp({ store: "ios", storeId: "571800810", country: "EG" })
    const b = await core.addApp({ store: "ios", storeId: "571800810", country: "eg" })
    expect(a.created).toBe(true)
    expect(b.created).toBe(false)
    expect(b.id).toBe(a.id)
    appId = a.id
    const jobs = await core.recentJobs()
    expect(jobs.filter((j) => j.type === "sync_app")).toHaveLength(1) // deduplicated
    const job = await core.claimJob()
    expect(job?.payload).toEqual({ appId })
    expect(await core.claimJob()).toBeNull()
    await core.finishJob(job!.id, "ok")
  })

  it("syncs listing, images and reviews", async () => {
    listing = {
      storeId: "571800810",
      name: "Calm",
      developer: "Calm.com, Inc.",
      category: "Health & Fitness",
      description: "Sleep better.",
      releaseNotes: "Bug fixes",
      price: "Free",
      priceValue: 0,
      currency: "USD",
      rating: 4.8,
      ratingsCount: 1_900_000,
      version: "6.52",
      updatedAt: new Date("2026-09-22"),
      sizeBytes: 250_000_000,
      contentRating: "4+",
      url: "https://apps.apple.com/eg/app/calm/id571800810",
      iconUrl: "https://img/icon-9",
      screenshots: [
        ...[1, 2, 3].map((i) => ({ url: `https://img/shot-${i}`, device: "phone" as const })),
        { url: "https://img/copy-of-3", device: "tablet" as const }, // same bytes as shot-3
      ],
    }
    reviews = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      author: `user${i}`,
      rating: (i % 5) + 1,
      title: `Title ${i}`,
      body: i === 0 ? "Paywall hit immediately" : `Body ${i}`,
      version: "6.52",
      date: new Date(Date.UTC(2026, 8, 27, 12) - i * 3600_000),
    }))
    const res = await core.syncApp(appId, { client: () => fakeClient, fetchImage, reviewsPerApp: 25 })
    expect(res).toMatchObject({
      name: "Calm",
      screenshots: 3,
      newScreenshots: 3,
      reviewsFetched: 25,
      newReviews: 25,
      changes: [],
      warnings: [],
    })

    const app = await core.getApp(appId)
    expect(app).toMatchObject({ name: "Calm", status: "ready", rating: 4.8, reviews_count: 25, screenshots_count: 3, country: "eg" })
    expect(app!.icon_path).toMatch(/^[0-9a-f-]+\/icon\/[0-9a-f]{32}\.webp$/)
    const shots = await core.getScreenshots(appId)
    expect(shots.map((s) => s.position)).toEqual([0, 1, 2])
    const file = core.resolveMediaPath(shots[0].path)!
    const meta = await sharp(file).metadata()
    expect(meta.format).toBe("webp")
    expect(core.resolveMediaPath("../../etc/passwd")).toBeNull()
    expect((await core.listApps())[0].preview).toHaveLength(3)
  })

  it("detects changes on the next sync", async () => {
    listing = {
      ...listing,
      price: "$4.99",
      version: "6.53",
      screenshots: [3, 4, 2].map((i) => ({ url: `https://img/shot-${i}`, device: "phone" as const })),
    }
    reviews = [{ id: "new1", author: "x", rating: 1, title: "Bad", body: "Crashes", version: "6.53", date: new Date() }, ...reviews]
    const res = await core.syncApp(appId, { client: () => fakeClient, fetchImage, reviewsPerApp: 25 })
    expect(res.newScreenshots).toBe(1)
    expect(res.newReviews).toBe(1)
    expect(res.changes).toEqual(["Price Free → $4.99", "Version 6.52 → 6.53", "1 screenshot added, 1 removed (now 3)"])

    const shots = await core.getScreenshots(appId, { includeInactive: true })
    expect(shots.filter((s) => s.active)).toHaveLength(3)
    expect(shots.filter((s) => !s.active)).toHaveLength(1)
    const changes = await core.getChanges({ appId })
    expect(changes).toHaveLength(3)
    const sc = changes.find((c) => c.field === "screenshots")!
    const before = await core.getScreenshotsByHashes(appId, sc.old_value as string[])
    expect(before).toHaveLength(3)

    // a sync with no changes records nothing new
    const again = await core.syncApp(appId, { client: () => fakeClient, fetchImage, reviewsPerApp: 25 })
    expect(again.changes).toEqual([])
    expect(await core.getChanges({ appId })).toHaveLength(3)
    expect((await core.dashboardStats()).changes_7d).toBe(3)
  })

  it("does not record a partial screenshot download as a change", async () => {
    const saved = listing
    listing = { ...listing, screenshots: [5, 6, 2].map((i) => ({ url: `https://img/shot-${i}`, device: "phone" as const })) }
    const flaky = (u: string) => (u.endsWith("shot-6") ? Promise.reject(new Error("HTTP 429")) : fetchImage(u))
    const res = await core.syncApp(appId, { client: () => fakeClient, fetchImage: flaky, reviewsPerApp: 25 })
    expect(res.warnings.join()).toMatch(/Screenshot download failed: HTTP 429/)
    expect(res.changes).toEqual([])
    expect((await core.getScreenshots(appId)).length).toBe(3) // previous set kept active
    listing = saved
    const clean = await core.syncApp(appId, { client: () => fakeClient, fetchImage, reviewsPerApp: 25 })
    expect(clean.changes).toEqual([])
  })

  it("recovers jobs interrupted by a worker restart", async () => {
    const id = await core.enqueue("sync_app", { appId })
    const job = await core.claimJob()
    expect(job?.id).toBe(id)
    await core.db()`update apps set status = 'syncing' where id = ${appId}`
    // while it runs, a new request gets its own queued job
    const second = await core.enqueue("sync_app", { appId })
    expect(second).not.toBe(id)
    expect(await core.requeueStale(30)).toBe(0) // not stale yet
    expect(await core.requeueStale(0)).toBe(1) // startup recovery
    expect((await core.getApp(appId))!.status).toBe("ready")
    await core.db()`delete from jobs`
  })

  it("saves a sync report and reports progress", async () => {
    const steps: string[] = []
    await core.syncApp(appId, { client: () => fakeClient, fetchImage, reviewsPerApp: 25, onProgress: (m) => steps.push(m) })
    expect(steps[0]).toBe("Fetching the store listing")
    expect(steps).toContain("Comparing with the last snapshot")
    const [{ sync_report }] = await core.db()<
      { sync_report: { ok: boolean; reviewsFetched: number } }[]
    >`select sync_report from apps where id = ${appId}`
    expect(sync_report).toMatchObject({ ok: true, reviewsFetched: 25 })
  })

  it("retries transient failures later and never runs two jobs for one app at once", async () => {
    await core.db()`delete from jobs`
    const a = await core.enqueue("sync_app", { appId })
    const b = await core.enqueue("analyse_app", { appId })
    const first = await core.claimJob()
    expect(first?.id).toBe(a)
    expect(await core.claimJob()).toBeNull() // same app is busy
    await core.setJobProgress(a, "Downloading screenshots 1/3")
    expect((await core.activeJobs(appId)).find((j) => j.id === a)?.progress).toBe("Downloading screenshots 1/3")
    expect(core.isTransient("HTTP 503 from itunes.apple.com")).toBe(true)
    expect(core.isTransient("App 1 not found in the US App Store")).toBe(false)
    await core.retryJob(a, "HTTP 503", 60_000)
    expect((await core.claimJob())?.id).toBe(b) // the retry waits, other work proceeds
    await core.finishJob(b, "ok")
    expect(await core.claimJob()).toBeNull()
    await core.db()`update jobs set run_after = now() where id = ${a}`
    expect((await core.claimJob())?.id).toBe(a)
    await core.db()`delete from jobs`
  })

  it("does not re-download an image listed under two URLs", async () => {
    const fetched: string[] = []
    await core.syncApp(appId, { client: () => fakeClient, fetchImage: (u) => (fetched.push(u), fetchImage(u)), reviewsPerApp: 25 })
    expect(fetched.filter((u) => !u.includes("icon"))).toEqual([])
  })

  it("claims at most one job per app even when workers race", async () => {
    await core.db()`delete from jobs`
    await core.enqueue("sync_app", { appId })
    await core.enqueue("analyse_app", { appId })
    const claimed = (await Promise.all(Array.from({ length: 6 }, () => core.claimJob()))).filter(Boolean)
    expect(claimed).toHaveLength(1)
    await core.db()`delete from jobs`
  })

  it("stops a sync when its signal is aborted", async () => {
    const ac = new AbortController()
    ac.abort(new Error("Job timed out after 15 min"))
    await expect(core.syncApp(appId, { client: () => fakeClient, fetchImage, signal: ac.signal })).rejects.toThrow(/timed out/)
    expect(core.isTransient("Job timed out after 15 min")).toBe(false)
    await core.syncApp(appId, { client: () => fakeClient, fetchImage, reviewsPerApp: 25 })
  })

  it("marks the app as errored when the store fails", async () => {
    const broken: StoreClient = {
      ...fakeClient,
      listing: async () => {
        throw new Error("HTTP 503 from itunes.apple.com")
      },
    }
    await expect(core.syncApp(appId, { client: () => broken, fetchImage })).rejects.toThrow(/503/)
    expect((await core.getApp(appId))!.status).toBe("error")
    await core.syncApp(appId, { client: () => fakeClient, fetchImage, reviewsPerApp: 25 })
    expect((await core.getApp(appId))!.last_error).toBeNull()
  })

  it("filters reviews", async () => {
    const neg = await core.getReviews(appId, { rating: "neg" })
    expect(neg.rows.every((r) => (r.rating ?? 0) <= 2)).toBe(true)
    expect((await core.getReviews(appId, { q: "paywall" })).total).toBe(1)
    const low = await core.getReviews(appId, { sort: "low", limit: 3 })
    expect(low.rows[0].rating).toBe(1)
  })

  it("analyses reviews with an OpenAI-compatible provider", async () => {
    await expect(core.analyseApp(appId)).rejects.toThrow(/not configured/)
    await core.saveSettings("ai", { baseUrl: aiUrl, model: "fake-model", apiKey: "k" })
    expect((await core.testConnection((await core.getSettings()).ai)).ms).toBeGreaterThanOrEqual(0)
    const res = await core.analyseApp(appId, { batchSize: 10 })
    expect(res.classified).toBe(26)
    const ins = await core.getInsights(appId)
    expect(ins!.reviews_count).toBe(26)
    const s = ins!.sentiment
    expect(s.positive + s.neutral + s.negative).toBe(26)
    expect(ins!.complaints[0].label).toBe("paywall before trying content")
    expect(ins!.summary).toMatch(/free sample/)
    expect((await core.topicCounts(appId)).map((t) => t.topic).sort()).toEqual(["Praise", "Pricing"])
    expect((await core.getReviews(appId, { topic: "Pricing" })).rows.every((r) => r.topic === "Pricing")).toBe(true)
    // second run has nothing new to classify
    expect((await core.analyseApp(appId)).classified).toBe(0)
  })

  it("stores opportunity signals and re-analyses reviews from an older classifier", async () => {
    const r0 = await core.getReview(appId, "r0")
    expect(r0).toMatchObject({
      wtp_signal: "churned",
      competitor_mentioned: "Headspace",
      evidence_span: "Paywall hit immediately",
      pain_score: 4,
    })
    expect((await core.getReview(appId, "r1"))!.evidence_span).toBeNull() // paraphrase dropped
    const [{ raw, version }] = await core.db()<{ raw: { pain: number }; version: number }[]>`
      select raw_analysis as raw, analysis_version as version from reviews where app_id = ${appId} and review_id = 'r0'`
    expect(raw.pain).toBe(4)
    expect(version).toBe(core.ANALYSIS_VERSION)
    expect(await core.signalCounts(appId)).toEqual([{ signal: "churned", count: 1 }])
    expect((await core.getReviews(appId, { signal: "any" })).total).toBe(1)
    expect((await core.getReviews(appId, { signal: "churned" })).rows[0].review_id).toBe("r0")
    expect((await core.getReviews(appId, { signal: "workaround" })).total).toBe(0)

    // reviews classified by an older analyser count as pending and are queued by analyse_all
    await core.db()`delete from jobs`
    expect(await core.queueReanalysis()).toBe(0)
    await core.db()`update reviews set analysis_version = 1 where app_id = ${appId} and review_id in ('r2', 'r3')`
    expect(await core.unanalysedCount(appId)).toBe(2)
    expect(await core.queueReanalysis()).toBe(1)
    expect((await core.activeJobs(appId)).map((j) => j.type)).toEqual(["analyse_app"])
    expect((await core.analyseApp(appId)).classified).toBe(2)
    expect(await core.unanalysedCount(appId)).toBe(0)
    await core.db()`delete from jobs`
  })

  it("manages boards", async () => {
    const id = await core.createBoard("Paywall ideas", "Pricing refs")
    const [shot] = await core.getScreenshots(appId)
    expect(await core.addBoardItem(id, { kind: "screenshot", screenshotId: shot.id, note: "Clean trial timeline" })).toBeTruthy()
    expect(await core.addBoardItem(id, { kind: "screenshot", screenshotId: shot.id })).toBeNull() // duplicate
    await core.addBoardItem(id, { kind: "review", appId, reviewId: "r0" })
    await expect(core.addBoardItem(id, { kind: "review", appId, reviewId: "missing" })).rejects.toThrow(/not found/)
    const board = await core.getBoard(id)
    expect(board!.items.map((i) => i.kind).sort()).toEqual(["review", "screenshot"])
    expect(board!.items.find((i) => i.kind === "review")!.review_body).toBe("Paywall hit immediately")
    const [summary] = await core.listBoards()
    expect(summary).toMatchObject({ screens: 1, reviews: 1 })
    expect(summary.preview).toHaveLength(1)
    await core.removeBoardItem(board!.items[0].id)
    expect((await core.getBoard(id))!.items).toHaveLength(1)
  })

  it("serves dashboard and compare data, then removes the app with its media", async () => {
    const stats = await core.dashboardStats()
    expect(stats.apps).toBe(1)
    expect(stats.perDay).toHaveLength(30)
    expect(stats.positive + stats.neutral + stats.negative).toBe(26)
    const cmp = await core.compareApps([appId, "not-a-uuid"])
    expect(cmp).toHaveLength(1)
    expect(cmp[0].insights?.complaints.length).toBeGreaterThan(0)
    expect(await core.ratingHistory(appId)).toHaveLength(1)
    await core.removeApp(appId)
    expect(await core.getApp(appId)).toBeNull()
    await expect(fs.stat(path.join(process.env.MEDIA_DIR!, appId))).rejects.toThrow()
  })
})
