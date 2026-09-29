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
let aiHits = 0
let embedServer: http.Server
let embedUrl = ""

/** Deterministic 1024-dim vector; texts equal after dropping case and punctuation get the same vector. */
function fakeVector(text: string) {
  let h = 2166136261
  for (const ch of text.toLowerCase().replace(/[^a-z0-9]/g, "")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const v: number[] = []
  for (let i = 0; i < 1024; i++) {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + i) | 0
    v.push(((h >>> 0) % 2000) / 1000 - 1)
  }
  return v
}

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
      aiHits++
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
      if (msgs[0].content.includes("SPEC")) {
        content = "# Spec\n\n## 1. Problem in the users' words\nQ1\n\n## 3. MVP scope\n1. Free sample before the paywall"
      } else if (user === null) {
        content = { ok: true }
      } else if (user && typeof user === "object" && "labels" in user) {
        // grouping: labels containing "paywall" merge into one opportunity (or an existing one); the rest stand alone
        const g = user as { existing: { id: number; label: string }[]; labels: { label: string; kind: string }[] }
        const map: unknown[] = []
        const fresh: { label: string; kind: string; labels: string[] }[] = []
        for (const l of g.labels) {
          const known = g.existing.find((e) => e.label.toLowerCase() === l.label)
          if (known) map.push({ label: l.label, opportunity_id: known.id })
          else fresh.push({ label: l.label, kind: l.kind, labels: [l.label] })
        }
        content = { map, new: fresh }
      } else if (Array.isArray(user)) {
        content = {
          items: user.map((r: { id: string; rating: number; text: string }) => ({
            id: r.id,
            sentiment: r.rating >= 4 ? "positive" : r.rating === 3 ? "neutral" : "negative",
            topic: r.rating <= 2 ? "Pricing" : "Praise",
            kind: r.text.includes("offline") ? "request" : !r.rating || r.rating <= 2 ? "complaint" : r.rating === 3 ? "request" : "praise",
            label: r.text.includes("offline")
              ? "Offline mode — sleep stories"
              : r.rating <= 2
                ? "Paywall before trying content"
                : "Arabic narration",
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
      res.end(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }))
    })
    await new Promise<void>((r) => aiServer.listen(0, r))
    aiUrl = `http://127.0.0.1:${(aiServer.address() as { port: number }).port}/v1`

    // Fake OpenAI-shaped embeddings endpoint.
    embedServer = http.createServer(async (req, res) => {
      let body = ""
      for await (const c of req) body += c
      const input = JSON.parse(body).input as string[]
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: fakeVector(t) })) }))
    })
    await new Promise<void>((r) => embedServer.listen(0, r))
    embedUrl = `http://127.0.0.1:${(embedServer.address() as { port: number }).port}/v1`
  })

  afterAll(async () => {
    aiServer?.close()
    embedServer?.close()
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

  it("groups labels into opportunities and ranks them", async () => {
    expect(await core.groupLabels()).toEqual({ mapped: 0, created: 2 })
    expect(await core.groupLabels()).toEqual({ mapped: 0, created: 0 }) // nothing unmapped: the model is not asked
    const list = await core.listOpportunities()
    expect(list.map((o) => o.label).sort()).toEqual(["arabic narration", "paywall before trying content"])
    const paywall = list.find((o) => o.label === "paywall before trying content")!
    expect(paywall).toMatchObject({ kind: "complaint", status: "surfaced", listings: 1, apps: 1 })
    expect(paywall.n).toBeGreaterThan(1)
    expect(paywall.score).toBeGreaterThan(0)
    expect(paywall.signals).toEqual({ paying_competitor: 0, churned: 1, workaround: 0, stated_wtp: 0 })
    expect(paywall.competitors).toEqual([{ name: "Headspace", count: 1 }])
    expect(paywall.avg_pain).toBeCloseTo(4, 5)
    expect(list[0].id).toBe(paywall.id) // highest score first
    expect((await core.listOpportunities({ kind: "request" })).map((o) => o.label)).toEqual(["arabic narration"])
    expect(await core.listOpportunities({ q: "nomatch" })).toEqual([])
    expect((await core.navSummary()).opportunities).toBe(2)
    expect((await core.dashboardStats()).opportunities).toBe(2)
    expect((await core.dashboardStats()).signals).toBeGreaterThanOrEqual(0)
  })

  it("keeps own apps out of the default view", async () => {
    expect(await core.listOpportunities({ own: "only" })).toEqual([])
    await core.setAppOwn(appId, true)
    expect(await core.listOpportunities()).toEqual([])
    expect(await core.listOpportunities({ own: "only" })).toHaveLength(2)
    expect(await core.listOpportunities({ own: "all" })).toHaveLength(2)
    await core.setAppOwn(appId, false)
    expect(await core.listOpportunities({ own: "only" })).toEqual([])
  })

  it("counts an app once per listing, not per country", async () => {
    const [b] = await core.db()<{ id: string }[]>`
      insert into apps (store, store_id, country, lang, name) values ('ios', '571800810', 'us', 'en', 'Calm US') returning id`
    await core.db()`
      insert into reviews (app_id, review_id, rating, body, label, label_kind, reviewed_at, wtp_signal, pain_score, analysed_at, analysis_version)
      values (${b.id}, 'u1', 1, 'no free trial', 'Paywall before trying content', 'complaint', now(), 'none', 2, now(), ${core.ANALYSIS_VERSION})`
    const paywall = (await core.listOpportunities()).find((o) => o.label === "paywall before trying content")!
    expect(paywall).toMatchObject({ apps: 2, listings: 1 })
    await core.db()`delete from apps where id = ${b.id}`
    // an unmapped label of a removed app is gone with it; nothing left to group
    expect(await core.groupLabels()).toEqual({ mapped: 0, created: 0 })
  })

  it("imports items, dedupes them and analyses them into the evidence", async () => {
    const first = await core.importItems([
      { body: "I wish there was an offline mode for sleep stories on flights", url: "https://example.com/t/1", source: "reddit" },
      { body: "  i wish there was an  OFFLINE mode for sleep stories on flights ", source: "reddit" }, // same text, same source
      { body: "   " },
    ])
    expect(first).toEqual({ inserted: 1, skipped: 2 })
    expect(await core.importItems([{ body: "I wish there was an offline mode for sleep stories on flights", source: "reddit" }])).toEqual({
      inserted: 0,
      skipped: 1,
    })
    await core.db()`delete from jobs`
    expect((await core.analyseItems()).classified).toBe(1)
    expect((await core.analyseItems()).classified).toBe(0)
    expect((await core.recentJobs()).map((j) => j.type)).toEqual(["group_labels"])
    const [item] = await core.db()<{ label: string; label_kind: string }[]>`select label, label_kind from items`
    expect(item).toEqual({ label: "Offline mode — sleep stories", label_kind: "request" })

    expect(await core.groupLabels()).toEqual({ mapped: 0, created: 1 })
    const opp = (await core.listOpportunities()).find((o) => o.label === "offline mode — sleep stories")!
    expect(opp).toMatchObject({ n: 1, listings: 0, apps: 0, kind: "request" })
    expect(opp.score).toBeGreaterThan(0)
    const detail = (await core.getOpportunity(opp.id))!
    expect(detail.evidence).toHaveLength(1)
    expect(detail.evidence[0]).toMatchObject({ source: "item", url: "https://example.com/t/1", app_name: null })
    expect(detail.labels).toEqual([{ label: "offline mode — sleep stories", count: 1 }])
    expect((await core.searchEvidence({ q: "flights" })).total).toBe(1)
    expect((await core.searchEvidence({ signal: "churned" })).rows.map((e) => e.ref)).toEqual([`${appId}:r0`])
    expect((await core.searchEvidence({ minPain: 4 })).total).toBeGreaterThan(1)
    expect((await core.searchEvidence({ label: "offline", limit: 5 })).total).toBe(1)
    await core.db()`delete from jobs`
  })

  it("generates a spec and manages the opportunity lifecycle", async () => {
    const list = await core.listOpportunities()
    const paywall = list.find((o) => o.label === "paywall before trying content")!
    const md = await core.generateSpec(paywall.id)
    expect(md).toMatch(/## 3|MVP/)
    const detail = (await core.getOpportunity(paywall.id))!
    expect(detail.spec_md).toBe(md)
    expect(detail.has_spec).toBe(true)

    await core.saveGate(paywall.id, { checks: { scope: true, demand: false }, notes: "ok" })
    await expect(core.saveGate(paywall.id, { checks: { nope: true } })).rejects.toThrow(/Unknown gate check/)
    expect((await core.getOpportunity(paywall.id))!.gate).toMatchObject({ checks: { scope: true, demand: false }, notes: "ok" })
    await core.recordOutcome(paywall.id, { installs: 120, paying: 2 })
    expect((await core.getOpportunity(paywall.id))!.outcome).toMatchObject({ installs: 120, trial_starts: 0, paying: 2 })
    await core.updateOpportunity(paywall.id, { label: "Free sample — before paywall", notes: "n" })
    expect(await core.getOpportunity(paywall.id)).toMatchObject({ label: "Free sample — before paywall", notes: "n" })

    await core.setOpportunityStatus(paywall.id, "validating")
    expect((await core.listOpportunities({ status: "validating" })).map((o) => o.id)).toEqual([paywall.id])
    await core.setOpportunityStatus(paywall.id, "killed", { reason: "too crowded", revisitAfter: "2027-01-01" })
    expect((await core.listOpportunities()).map((o) => o.id)).not.toContain(paywall.id)
    expect((await core.listOpportunities({ status: "killed" })).map((o) => o.id)).toEqual([paywall.id])
    expect((await core.getOpportunity(paywall.id))!.killed_reason).toBe("too crowded")
    expect((await core.navSummary()).opportunities).toBe(2)

    // a new label meaning the same thing maps onto the killed opportunity and stays hidden
    await core.db()`
      insert into reviews (app_id, review_id, rating, body, label, label_kind, reviewed_at, analysed_at, analysis_version)
      values (${appId}, 'k1', 1, 'x', 'Free sample — before paywall', 'complaint', now(), now(), ${core.ANALYSIS_VERSION})`
    expect(await core.groupLabels()).toEqual({ mapped: 1, created: 0 })
    expect((await core.listOpportunities()).map((o) => o.id)).not.toContain(paywall.id)
    await core.db()`delete from reviews where review_id = 'k1'`

    await core.setOpportunityStatus(paywall.id, "surfaced")
    const other = list.find((o) => o.label === "arabic narration")!
    await core.mergeOpportunities(other.id, paywall.id)
    expect(await core.getOpportunity(other.id)).toBeNull()
    const merged = (await core.getOpportunity(paywall.id))!
    expect(merged.labels.map((l) => l.label).sort()).toEqual([
      "arabic narration",
      "free sample — before paywall",
      "paywall before trying content",
    ])
    await expect(core.mergeOpportunities(paywall.id, paywall.id)).rejects.toThrow(/itself/)
  })

  it("takes the score weights from settings", async () => {
    const [b] = await core.db()<{ id: string }[]>`
      insert into apps (store, store_id, country, lang, name) values ('ios', '999', 'us', 'en', 'Other') returning id`
    await core.db()`
      insert into reviews (app_id, review_id, rating, body, label, label_kind, reviewed_at, wtp_signal, pain_score, analysed_at, analysis_version)
      values (${b.id}, 'w1', 1, 'no free trial', 'Paywall before trying content', 'complaint', now(), 'none', 2, now(), ${core.ANALYSIS_VERSION})`
    const find = async () => (await core.listOpportunities()).find((o) => o.label === "Free sample — before paywall")!
    const base = await find()
    expect(base.listings).toBe(2)
    const wtpShare = Object.values(base.signals).reduce((a, n) => a + n, 0) / base.n
    const expected = (w: object) =>
      core.opportunityScore({ recent: base.recent, listings: base.listings, avgPain: base.avg_pain, wtpShare }, w)
    expect(base.score).toBeCloseTo(expected({}), 6)

    await core.saveSettings("score", { listingWeight: 0 })
    const flat = await find()
    expect(flat.score).toBeLessThan(base.score)
    expect(flat.score).toBeCloseTo(base.score / 1.5, 6) // 1 + 0.5 * (2 - 1)
    expect(flat.score).toBeCloseTo(expected({ listingWeight: 0 }), 6)
    expect((await core.getOpportunity(base.id))!.score).toBeCloseTo(flat.score, 6)

    await core.saveSettings("score", { listingWeight: 0.5, painWeight: 3, wtpWeight: 0 })
    expect((await find()).score).toBeCloseTo(expected({ painWeight: 3, wtpWeight: 0 }), 6)
    // a longer half-life keeps old evidence alive
    await core.saveSettings("score", { painWeight: 1, wtpWeight: 2, halfLifeDays: 3650 })
    expect((await find()).recent).toBeGreaterThan(base.recent)
    await core.saveSettings("score", { halfLifeDays: 90 })
    expect((await find()).score).toBeCloseTo(base.score, 6)
    expect((await core.getSettings()).score).toEqual({
      listingWeight: 0.5,
      painWeight: 1,
      wtpWeight: 2,
      halfLifeDays: 90,
      autoMapThreshold: 0.86,
    })
    await core.db()`delete from apps where id = ${b.id}`
  })

  it("records verdicts, writes corrections through and reports accuracy", async () => {
    const r0 = `${appId}:r0`
    const r2 = `${appId}:r2`
    const [{ id: itemId }] = await core.db()<{ id: string }[]>`select id::text from items limit 1`
    const refs = async (o: { onlySignals?: boolean } = {}) => (await core.reviewQueue({ limit: 100, ...o })).map((e) => e.ref)

    expect(await refs({ onlySignals: true })).toEqual([r0]) // the only row with a signal
    const all = await core.reviewQueue({ limit: 100 })
    expect(all[0].ref).toBe(r0) // signals first
    expect(all[0]).toMatchObject({ source: "review", wtp_signal: "churned", label_kind: "complaint" })
    expect(all.map((e) => e.ref)).toContain(r2)
    expect(await core.reviewQueue({ limit: 3 })).toHaveLength(3)

    expect(await core.accuracyStats()).toMatchObject({
      total: 0,
      correct: 0,
      wrong: 0,
      accuracy: 0,
      byVersion: [],
      bySignal: [],
      byKind: [],
    })

    const v = await core.recordVerdict({ source: "review", ref: r0, verdict: "correct" })
    expect(v).toMatchObject({ source: "review", ref: r0, verdict: "correct", corrected: null, analysis_version: core.ANALYSIS_VERSION })
    await core.recordVerdict({
      source: "review",
      ref: r2,
      verdict: "wrong",
      notes: "would actually pay",
      corrected: { wtp_signal: "stated_wtp", pain_score: 5, label_kind: "request", label: "Free sample — before paywall." },
    })
    await core.recordVerdict({ source: "item", ref: itemId, verdict: "correct" })

    expect(await refs()).not.toContain(r0)
    expect(await refs()).not.toContain(r2)
    expect(await refs({ onlySignals: true })).toEqual([]) // r2 now has a signal but a verdict too
    const fixed = await core.getReview(appId, "r2")
    expect(fixed).toMatchObject({ wtp_signal: "stated_wtp", pain_score: 5, label_kind: "request", label: "Free sample — before paywall" })
    expect((await core.searchEvidence({ signal: "stated_wtp" })).rows.map((e) => e.ref)).toEqual([r2])

    // recording again replaces the verdict instead of adding one
    await core.recordVerdict({ source: "review", ref: r0, verdict: "wrong" })
    await core.recordVerdict({ source: "review", ref: r0, verdict: "correct" })
    const stats = await core.accuracyStats()
    expect(stats).toMatchObject({ total: 3, correct: 2, wrong: 1 })
    expect(stats.accuracy).toBeCloseTo(2 / 3, 10)
    expect(stats.byVersion).toEqual([{ version: core.ANALYSIS_VERSION, total: 3, correct: 2 }])
    // bucketed by what the model said, so r2's correction does not move it out of "none"
    expect(stats.bySignal).toEqual([
      { signal: "none", total: 2, correct: 1 },
      { signal: "churned", total: 1, correct: 1 },
    ])
    expect(stats.byKind.reduce((a, k) => a + k.total, 0)).toBe(3)

    expect(await core.deleteVerdict("item", itemId)).toBe(true)
    expect(await core.deleteVerdict("item", itemId)).toBe(false)
    expect((await core.accuracyStats()).total).toBe(2)
    expect(await refs()).toContain(itemId)

    await expect(core.recordVerdict({ source: "review", ref: `${appId}:nope`, verdict: "correct" })).rejects.toThrow(/not found/)
    await expect(core.recordVerdict({ source: "review", ref: "garbage", verdict: "correct" })).rejects.toThrow(/Invalid review ref/)
    await expect(core.recordVerdict({ source: "item", ref: "x", verdict: "correct" })).rejects.toThrow(/Invalid item ref/)
    await expect(core.recordVerdict({ source: "item", ref: itemId, verdict: "maybe" as never })).rejects.toThrow(/correct or wrong/)
    await expect(
      core.recordVerdict({ source: "item", ref: itemId, verdict: "wrong", corrected: { wtp_signal: "bogus" as never } }),
    ).rejects.toThrow(/Invalid wtp_signal/)
    await core.db()`delete from review_verdicts`
    // put r2 back as the classifier had it, for the tests that follow
    await core.db()`update reviews set wtp_signal = 'none', pain_score = 4, label = 'Paywall before trying content', label_kind = 'complaint'
      where app_id = ${appId} and review_id = 'r2'`
  })

  it("embeds labels, maps near-duplicates onto killed opportunities without the model, and finds similar ones", async () => {
    const sql = core.db()
    expect(await core.embedLabels()).toEqual({ embedded: 0 }) // not configured: silently nothing
    expect(await core.recomputeCentroids()).toBe(0)
    expect(await core.similarOpportunities(1)).toEqual([])
    const [{ vector }] = await sql<{ vector: boolean }[]>`select to_regclass('label_embeddings') is not null as vector`
    expect(vector).toBe(true) // pgvector is installed on the test database

    await core.saveSettings("ai", { embedding: { baseUrl: embedUrl, apiKey: "", model: "fake-embed", dimensions: 1024 } })
    expect(core.embeddingConfigured(await core.getSettings())).toBe(true)
    const labelCount = (await sql<{ n: number }[]>`select count(*)::int as n from opportunity_labels`)[0].n
    expect(await core.embedLabels()).toEqual({ embedded: labelCount })
    expect((await sql<{ n: number }[]>`select count(*)::int as n from label_embeddings`)[0].n).toBe(labelCount)
    expect(await core.embedLabels()).toEqual({ embedded: 0 })

    const opps = await core.listOpportunities({ status: "all" })
    expect(await core.recomputeCentroids()).toBe(opps.length)
    const [{ n: distant }] = await sql<{ n: number }[]>`
      select count(*)::int as n from opportunities o
      where o.centroid is null or o.centroid <=> (
        select avg(e.v) from label_embeddings e join opportunity_labels ol on ol.label = e.label where ol.opportunity_id = o.id) > 1e-6`
    expect(distant).toBe(0)

    const offline = opps.find((o) => o.label === "offline mode — sleep stories")!
    const paywall = opps.find((o) => o.label === "Free sample — before paywall")!
    await core.setOpportunityStatus(offline.id, "killed", { reason: "too niche" })

    // same words, different punctuation: an identical vector, so it maps onto the killed opportunity with no chat call
    await sql`
      insert into reviews (app_id, review_id, rating, body, label, label_kind, reviewed_at, analysed_at, analysis_version)
      values (${appId}, 'e1', 2, 'x', 'Offline mode - sleep stories!!', 'request', now(), now(), ${core.ANALYSIS_VERSION})`
    const hits = aiHits
    expect(await core.groupLabels()).toEqual({ mapped: 1, created: 0 })
    expect(aiHits).toBe(hits)
    expect(
      (
        await sql<{ opportunity_id: number }[]>`
      select opportunity_id::int from opportunity_labels where label = 'offline mode - sleep stories!!'`
      )[0].opportunity_id,
    ).toBe(offline.id)
    expect((await core.listOpportunities()).map((o) => o.id)).not.toContain(offline.id) // still killed and hidden

    // a label that resembles nothing goes to the model, and both opportunities get fresh centroids
    await sql`
      insert into reviews (app_id, review_id, rating, body, label, label_kind, reviewed_at, analysed_at, analysis_version)
      values (${appId}, 'e2', 2, 'x', 'Dark mode — night reading', 'request', now(), now(), ${core.ANALYSIS_VERSION})`
    expect(await core.groupLabels()).toEqual({ mapped: 0, created: 1 })
    expect(aiHits).toBeGreaterThan(hits)
    const dark = (await core.listOpportunities({ status: "all" })).find((o) => o.label === "dark mode — night reading")!
    expect((await sql<{ has: boolean }[]>`select centroid is not null as has from opportunities where id = ${dark.id}`)[0].has).toBe(true)

    const similar = await core.similarOpportunities(paywall.id)
    expect(similar.map((s) => s.id).sort()).toEqual([offline.id, dark.id].sort())
    expect(similar.find((s) => s.id === offline.id)).toMatchObject({ status: "killed", label: "offline mode — sleep stories" })
    expect(similar[0].similarity).toBeGreaterThanOrEqual(similar[1].similarity)
    expect(await core.similarOpportunities(paywall.id, 1)).toHaveLength(1)
    // the killed opportunity's nearest neighbour is not itself
    expect((await core.similarOpportunities(offline.id)).map((s) => s.id)).not.toContain(offline.id)

    // a merge refreshes the surviving centroid
    await core.mergeOpportunities(dark.id, paywall.id)
    const [{ close }] = await sql<{ close: boolean }[]>`
      select o.centroid <=> (select avg(e.v) from label_embeddings e join opportunity_labels ol on ol.label = e.label
        where ol.opportunity_id = o.id) < 1e-6 as close from opportunities o where o.id = ${paywall.id}`
    expect(close).toBe(true)

    await sql`delete from reviews where review_id in ('e1', 'e2')`
    await core.saveSettings("ai", { embedding: { baseUrl: "", apiKey: "", model: "", dimensions: 1024 } })
    expect(await core.similarOpportunities(paywall.id)).toEqual([]) // embeddings off
    await core.setOpportunityStatus(offline.id, "surfaced")
    await sql`delete from jobs`
  })

  it("refuses the same Google Play app in a second country", async () => {
    const a = await core.addApp({ store: "android", storeId: "com.example.app", country: "us" })
    await expect(core.addApp({ store: "android", storeId: "com.example.app", country: "eg" })).rejects.toThrow(/not per country/)
    expect((await core.addApp({ store: "android", storeId: "com.example.app", country: "us", lang: "ar" })).id).toBe(a.id)
    await core.db()`delete from apps where id = ${a.id}`
    await core.db()`delete from jobs`
  })

  it("never runs two group_labels jobs at once", async () => {
    await core.db()`delete from jobs`
    const a = await core.enqueue("group_labels")
    await core.db()`insert into jobs (type) values ('group_labels')`
    await core.enqueue("analyse_items")
    const first = await core.claimJob()
    expect(first?.id).toBe(a)
    const second = await core.claimJob()
    expect(second?.type).toBe("analyse_items") // the other group_labels waits
    expect(await core.claimJob()).toBeNull()
    await core.finishJob(a, "ok")
    expect((await core.claimJob())?.type).toBe("group_labels")
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
