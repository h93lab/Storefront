import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { classifyReply, startFakeAnthropic, type FakeAnthropic } from "./fake-anthropic"

/** Message Batches flow against a real Postgres and a fake Anthropic API (the database is wiped). */
const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

suite("Anthropic Message Batches", () => {
  let core: typeof import("../src/index")
  let fake: FakeAnthropic
  let appId = ""

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    core = await import("../src/index")
    await core.db().unsafe("drop schema public cascade; create schema public;")
    await (await import("../src/migrate")).migrate(() => {})
    fake = await startFakeAnthropic((system, user) => {
      if (system.includes("group near-duplicate labels")) {
        const u = JSON.parse(user) as { complaints: unknown; requests: unknown }
        return JSON.stringify({ complaints: u.complaints, requests: u.requests, summary: "Offer a free sample." })
      }
      return classifyReply(user)
    })
    await core.saveSettings("ai", { provider: "anthropic", baseUrl: fake.url, apiKey: "sk-test", model: "claude-haiku-4-5", batch: true })
    const [app] = await core.db()<{ id: string }[]>`
      insert into apps (store, store_id, country, lang, name) values ('ios', '1', 'us', 'en', 'Calm') returning id`
    appId = app.id
    const rows = Array.from({ length: 45 }, (_, i) => ({
      app_id: appId,
      review_id: `r${i}`,
      rating: i % 3 === 0 ? 5 : 1,
      body: i === 1 ? "I went back to Headspace" : `review ${i}`,
      reviewed_at: new Date(Date.now() - i * 86_400_000).toISOString(),
    }))
    await core.db()`insert into reviews ${core.db()(rows)}`
  })

  afterAll(async () => {
    await fake?.close()
    if (core) await core.closeDb()
  })

  it("submits reviews as one batch of 20-row requests instead of classifying", async () => {
    expect(core.aiConfigured(await core.getSettings())).toBe(true)
    const res = await core.analyseApp(appId)
    expect(res).toEqual({ classified: 0, reviewsCount: 0, batched: 45 })
    const create = fake.requests.find((r) => r.path === "/v1/messages/batches")!
    expect(create.body.requests.map((r: { custom_id: string }) => r.custom_id)).toEqual(["req-0", "req-1", "req-2"])
    expect(create.body.requests[0].params).toMatchObject({
      model: "claude-haiku-4-5",
      max_tokens: 12_000,
      system: [{ type: "text", cache_control: { type: "ephemeral" } }],
    })
    expect(JSON.parse(create.body.requests[0].params.messages[0].content.split("\n\n")[0])).toHaveLength(20)
    expect(fake.requests.some((r) => r.path === "/v1/messages")).toBe(false) // nothing classified synchronously
    const [b] = await core.db()<{ status: string; request_count: number; payload: { requests: { ids: string[] }[] } }[]>`
      select status, request_count, payload from ai_batches`
    expect(b).toMatchObject({ status: "submitted", request_count: 3 })
    expect(b.payload.requests.map((r) => r.ids.length)).toEqual([20, 20, 5])
    expect(await core.unanalysedCount(appId)).toBe(45)
    // a batch for this app is in flight: nothing is submitted twice
    expect(await core.submitClassificationBatch("reviews", appId)).toBe(0)
    expect(fake.requests.filter((r) => r.path === "/v1/messages/batches")).toHaveLength(1)
  })

  it("applies results when the batch has ended and writes the insights", async () => {
    await core.db()`delete from jobs`
    expect(await core.pollBatches()).toEqual({ polled: 1, ended: 0 }) // still in progress
    expect(await core.unanalysedCount(appId)).toBe(45)
    expect(await core.getInsights(appId)).toBeNull()

    expect(await core.pollBatches()).toEqual({ polled: 1, ended: 1 })
    expect(await core.unanalysedCount(appId)).toBe(0)
    expect(await core.getReview(appId, "r1")).toMatchObject({
      label: "Paywall before trying content",
      wtp_signal: "churned",
      competitor_mentioned: "Headspace",
      evidence_span: "went back to Headspace",
      pain_score: 4,
    })
    expect(await core.getReview(appId, "r0")).toMatchObject({ label: "Arabic narration", sentiment: "positive" })
    const ins = await core.getInsights(appId)
    expect(ins).toMatchObject({ reviews_count: 45, summary: "Offer a free sample." })
    expect(ins!.complaints[0]).toEqual({ label: "paywall before trying content", count: 30 })
    expect((await core.recentJobs()).map((j) => j.type)).toEqual(["group_labels"])
    const [b] = await core.db()<
      { status: string; ended_at: Date | null; error: string | null }[]
    >`select status, ended_at, error from ai_batches`
    expect(b.status).toBe("ended")
    expect(b.ended_at).not.toBeNull()
    expect(await core.pollBatches()).toEqual({ polled: 0, ended: 0 })
  })

  it("submits nothing (and never calls the provider) when there is nothing pending", async () => {
    const before = fake.requests.length
    expect(await core.submitClassificationBatch("reviews", appId)).toBe(0)
    expect(await core.submitClassificationBatch("items")).toBe(0)
    expect((await core.analyseApp(appId)).batched).toBe(0)
    expect((await core.analyseItems()).batched).toBe(0)
    expect(fake.requests.length).toBe(before)
  })

  it("batches imported items, then queues grouping when they land", async () => {
    await core.db()`delete from jobs`
    await core.importItems([
      { body: "I wish there was an offline mode for sleep stories on flights", source: "reddit" },
      { body: "Another post asking for offline sleep stories", source: "reddit" },
    ])
    expect(await core.analyseItems()).toEqual({ classified: 0, batched: 2 })
    const [b] = await core.db()<{ kind: string; app_id: string | null }[]>`select kind, app_id from ai_batches order by id desc limit 1`
    expect(b).toEqual({ kind: "items", app_id: null })
    expect((await core.recentJobs()).map((j) => j.type)).toEqual([]) // no grouping until results land
    expect(await core.pollBatches()).toEqual({ polled: 1, ended: 0 })
    expect(await core.pollBatches()).toEqual({ polled: 1, ended: 1 })
    const items = await core.db()<{ label: string; label_kind: string }[]>`select label, label_kind from items`
    expect(items).toEqual([
      { label: "Offline mode — sleep stories", label_kind: "request" },
      { label: "Offline mode — sleep stories", label_kind: "request" },
    ])
    expect((await core.recentJobs()).map((j) => j.type)).toEqual(["group_labels"])
  })

  it("marks a batch failed when every request errors and leaves the rows pending for a retry", async () => {
    await core.db()`delete from jobs`
    await core.db()`update reviews set analysed_at = null, analysis_version = 0 where review_id in ('r5', 'r6')`
    await core.db()`delete from insights`
    fake.failBatches = true
    expect(await core.analyseApp(appId)).toMatchObject({ batched: 2 })
    await core.pollBatches()
    expect(await core.pollBatches()).toEqual({ polled: 1, ended: 1 })
    const [b] = await core.db()<{ status: string; error: string | null }[]>`select status, error from ai_batches order by id desc limit 1`
    expect(b.status).toBe("failed")
    expect(b.error).toMatch(/req-0: boom/)
    expect(await core.unanalysedCount(appId)).toBe(2)
    expect(await core.getInsights(appId)).toBeNull() // no summary for a failed batch
    expect((await core.recentJobs()).map((j) => j.type)).toEqual([])
    fake.failBatches = false
    // a failed batch is not in flight: the next run resubmits the same rows
    expect(await core.analyseApp(appId)).toMatchObject({ batched: 2 })
  })

  it("still classifies synchronously when batch mode is off", async () => {
    await core.pollBatches()
    await core.pollBatches()
    await core.saveSettings("ai", { batch: false })
    await core.db()`update reviews set analysed_at = null, analysis_version = 0 where review_id = 'r7'`
    expect(await core.analyseApp(appId)).toMatchObject({ classified: 1, reviewsCount: 45 })
    expect(fake.requests.some((r) => r.path === "/v1/messages")).toBe(true)
  })
})
