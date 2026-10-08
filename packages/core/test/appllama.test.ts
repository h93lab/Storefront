import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { FAKE_APP_IDS, startFakeAppllama, type FakeAppllama } from "./fake-appllama"

/** Appllama OAuth, MCP client and market saving against a fake server. Needs TEST_DATABASE_URL (the database is wiped). */
const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const { calm, other } = FAKE_APP_IDS

suite("appllama", () => {
  let core: typeof import("../src/index")
  let fake: FakeAppllama
  let mediaDir = ""
  const today = () => new Date().toISOString().slice(0, 10)
  const settings = async () => (await core.getSettings()).appllama
  const tokens = () => settings().then((s) => s.accessToken)

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "lens-appllama-"))
    process.env.MEDIA_DIR = mediaDir
    core = await import("../src/index")
    await core.db().unsafe("drop schema public cascade; create schema public;")
    await (await import("../src/migrate")).migrate(() => {})
    fake = await startFakeAppllama()
    await core.saveSettings("appllama", { mcpUrl: fake.mcpUrl })
  })

  afterAll(async () => {
    await fake?.close()
    if (core) await core.closeDb()
    if (mediaDir) await fs.rm(mediaDir, { recursive: true, force: true })
  })

  it("registers a client, exchanges the code with PKCE and stores tokens", async () => {
    expect(core.appllamaConnected(await core.getSettings())).toBe(false)
    const redirect = "http://localhost:3000/api/appllama/callback"
    const authorize = new URL(await core.beginAppllamaConnect(redirect))
    expect(authorize.origin).toBe(fake.base)
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: redirect,
      scope: "appllama",
      code_challenge_method: "S256",
    })
    expect(fake.registrations).toHaveLength(1)
    expect(fake.registrations[0]).toMatchObject({ client_name: "Storefront Lens", redirect_uris: [redirect], scope: "appllama" })
    const s0 = await core.getSettings()
    expect(s0.appllama).toMatchObject({ clientId: "client-1", clientSecret: "secret-1", accessToken: "" })
    expect(s0.appllama_pending.state).toBe(authorize.searchParams.get("state"))

    const res = await fetch(authorize, { redirect: "manual" })
    const back = new URL(res.headers.get("location")!)
    await expect(core.finishAppllamaConnect({ code: back.searchParams.get("code")!, state: "wrong" })).rejects.toThrow(/state/)
    await core.finishAppllamaConnect({ code: back.searchParams.get("code")!, state: back.searchParams.get("state")! })

    const s = await core.getSettings()
    expect(s.appllama).toMatchObject({ accessToken: "good-token", refreshToken: "refresh-1", scope: "appllama" })
    expect(s.appllama.connectedAt).toBeTruthy()
    expect(new Date(s.appllama.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 3_000_000)
    expect(s.appllama_pending.state).toBe("")
    expect(core.appllamaConnected(s)).toBe(true)

    // a second connect reuses the registered client
    await core.beginAppllamaConnect(redirect)
    expect(fake.registrations).toHaveLength(1)
  })

  it("calls tools with the bearer token and counts them (get_credits is free)", async () => {
    const credits = await core.appllamaCredits()
    expect(credits.remaining).toBe(1000)
    expect((await settings()).usage.calls).toBe(0)
    const found = await core.appllamaSearch({ query: "calm" })
    expect(found.apps.map((a) => a.app_id)).toEqual([calm])
    expect(fake.calls.at(-1)).toMatchObject({ tool: "search_apps", args: { query: "calm" }, token: "good-token" })
    expect(await settings()).toMatchObject({ usage: { day: today(), calls: 1 } })
  })

  it("refreshes an expiring token before calling, and after a 401", async () => {
    await core.saveSettings("appllama", { expiresAt: new Date(Date.now() + 10_000).toISOString() })
    await core.appllamaCredits()
    expect(await tokens()).toBe("good-token-2")
    expect(fake.tokenRequests.at(-1)).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" })
    expect((await settings()).refreshToken).toBe("refresh-2")
    expect(new Date((await settings()).expiresAt!).getTime()).toBeGreaterThan(Date.now() + 3_000_000)

    await core.saveSettings("appllama", { accessToken: "stale" })
    const before = fake.tokenRequests.length
    expect((await core.appllamaCredits()).remaining).toBe(1000)
    expect(fake.tokenRequests.length).toBe(before + 1)
    expect(await tokens()).toBe("good-token-2")
  })

  it("turns 429 and 402 into friendly errors", async () => {
    fake.failNext = 429
    await expect(core.appllamaCredits()).rejects.toThrow(/rate limit/i)
    fake.failNext = 402
    await expect(core.appllamaCredits()).rejects.toThrow(/credits/i)
  })

  it("marks library and saved apps in search results", async () => {
    await core.addApp({ store: "ios", storeId: other })
    const res = await core.appllamaSearch({})
    const by = Object.fromEntries(res.apps.map((a) => [a.app_id, a]))
    expect(by[calm]).toMatchObject({ saved: false, library_app_id: null })
    expect(by[other]).toMatchObject({ saved: false })
    expect(by[other].library_app_id).toBeTruthy()
  })

  it("saves an app with its profile and every screen, images stored as WebP", async () => {
    const progress: string[] = []
    const out = await core.saveMarketApp(calm, { onProgress: (m) => progress.push(m) })
    expect(out.screens).toBe(15)
    expect(out.creditsSpent).toBe(core.estimateCredits({ screens_count: 15 }))
    expect(progress.length).toBeGreaterThan(1)

    const sql = core.db()
    const [app] = await sql`select store, store_id, country, name, developer, category, description from apps where id = ${out.appId}`
    expect(app).toMatchObject({
      store: "ios",
      store_id: calm,
      country: "us",
      name: "Calm",
      developer: "Calm Inc",
      category: "Health & Fitness",
    })
    const [sync] = await sql`select count(*)::int as n from jobs where type = 'sync_app' and payload->>'appId' = ${out.appId}`
    expect(sync.n).toBe(1)

    const m = await core.getMarket(out.appId)
    expect(m).toMatchObject({
      appllama_id: calm,
      revenue_monthly_usd: 4_200_000,
      downloads: 1_200_000,
      rating: 3.7,
      ratings_count: 1_900_000,
      category_rank: 4,
      launched: "2012-05-01",
      screens_count: 15,
      screens_synced: 15,
      screens_cursor: null,
      credits_spent: 3,
    })
    expect(m!.screens_fetched_at).toBeTruthy()
    expect(m!.profile).toMatchObject({ name: "Calm", top_countries: ["US", "GB"] })
    expect(m!.profile).not.toHaveProperty("hint")
    expect(m!.profile).not.toHaveProperty("credits")

    const images = m!.screens.filter((s) => s.kind === "image")
    expect(images).toHaveLength(14)
    for (const s of images) {
      expect(s.path).toMatch(new RegExp(`^${out.appId}/market/[0-9a-f]{32}\\.webp$`))
      await expect(fs.stat(path.join(mediaDir, s.path!))).resolves.toBeTruthy()
    }
    const video = m!.screens.find((s) => s.kind === "video")!
    expect(video).toMatchObject({ path: null, duration_ms: 4000 })
    expect(images[0]).toMatchObject({ colors: ["#336699", "#ffffff"], ui_elements: ["button", "tab bar"] })

    // saving again does not pay for the screens twice
    const callsBefore = fake.calls.filter((c) => c.tool === "list_app_screens").length
    await core.saveMarketApp(calm)
    expect(fake.calls.filter((c) => c.tool === "list_app_screens").length).toBe(callsBefore)
  })

  it("returns screens in journey order", async () => {
    const [{ id }] = await core.db()<{ id: string }[]>`select app_id::text as id from app_market where appllama_id = ${calm}`
    const m = (await core.getMarket(id))!
    expect(m.sections.map((s) => s.section)).toEqual(["welcome-screen", "onboarding", "paywall", "other-tabs"])
    const rank = ["welcome-screen", "onboarding", "paywall", "other-tabs"]
    const keys = m.screens.map((s) => [rank.indexOf(s.section!), s.position!])
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    expect(m.prices).toEqual({ monthly: 14.99, annual: 49.99, weekly: 4.99, lifetime: 399.99 })
    expect(await core.getMarket("00000000-0000-0000-0000-000000000000")).toBeNull()
  })

  it("resumes an interrupted save without duplicating screens or paying twice", async () => {
    const ctl = new AbortController()
    const start = fake.calls.length
    await expect(core.saveMarketApp(other, { signal: ctl.signal, onProgress: (m) => /1 page/.test(m) && ctl.abort() })).rejects.toThrow()
    const sql = core.db()
    const [mid] = await sql`
      select app_id::text, screens_cursor, screens_synced, screens_fetched_at from app_market where appllama_id = ${other}`
    expect(mid).toMatchObject({ screens_cursor: "10", screens_synced: 10, screens_fetched_at: null })

    const out = await core.saveMarketApp(other)
    expect(out.screens).toBe(12)
    const pages = fake.calls.slice(start).filter((c) => c.tool === "list_app_screens" && c.args.app_id === other)
    expect(pages.map((c) => c.args.cursor ?? null)).toEqual([null, "10"])
    const [{ n, distinct }] =
      await sql`select count(*)::int as n, count(distinct screen_id)::int as distinct from app_screens where app_id = ${mid.app_id}`
    expect(n).toBe(12)
    expect(distinct).toBe(12)
    const m = await core.getMarket(mid.app_id)
    expect(m).toMatchObject({ screens_cursor: null, screens_synced: 12 })
    expect(m!.screens_fetched_at).toBeTruthy()

    // refresh re-walks everything from the start
    const refreshStart = fake.calls.length
    const again = await core.refreshMarketApp(mid.app_id)
    expect(again.screens).toBe(12)
    expect(
      fake.calls
        .slice(refreshStart)
        .filter((c) => c.tool === "list_app_screens")
        .map((c) => c.args.cursor ?? null),
    ).toEqual([null, "10"])
  })

  it("lists and summarises saved apps", async () => {
    const saved = await core.listSavedMarket()
    expect(saved.map((s) => s.appllama_id).sort()).toEqual([other, calm].sort())
    const calmRow = saved.find((s) => s.appllama_id === calm)!
    expect(calmRow).toMatchObject({
      name: "Calm",
      revenue_monthly_usd: 4_200_000,
      monthly_price: 14.99,
      annual_price: 49.99,
      screens_synced: 15,
    })
    const summary = await core.marketSummaryFor([calmRow.app_id, calmRow.app_id, "00000000-0000-0000-0000-000000000000"])
    expect(summary).toHaveLength(1)
    expect(await core.marketSummaryFor([])).toEqual([])
    const search = await core.appllamaSearch({})
    expect(search.apps.every((a) => a.saved && a.library_app_id)).toBe(true)
  })

  it("estimates credits and derives IAP prices", () => {
    expect(core.estimateCredits({ screens_count: 0 })).toBe(1)
    expect(core.estimateCredits({ screens_count: 10 })).toBe(2)
    expect(core.estimateCredits({ screens_count: 11 })).toBe(3)
    expect(core.estimateCredits({ screens_count: 15 })).toBe(3)
    expect(
      core.iapPrices({
        in_app_purchases: [
          { title: "A", duration: "Monthly", price: 9.99 },
          { title: "B", duration: "Monthly", price: 7.99 },
          { title: "C", duration: "Annual", price: "59.99" },
          { title: "Forever lifetime", duration: "Unknown", price: 99 },
          { title: "Coins", duration: "Unknown", price: 1.99 },
        ],
      }),
    ).toEqual({ monthly: 7.99, annual: 59.99, weekly: null, lifetime: 99 })
    expect(core.iapPrices({})).toEqual({ monthly: null, annual: null, weekly: null, lifetime: null })
  })

  it("demandHint passes on weak popular apps or broad evidence", () => {
    expect(core.demandHint({ n: 3, listings: 1 })).toBe("unknown")
    expect(core.demandHint({ n: 15, listings: 2 })).toBe("pass")
    expect(core.demandHint({ n: 15, listings: 1 })).toBe("unknown")
    expect(core.demandHint({ n: 2, listings: 1, apps: [{ rating: 3.8, ratings_count: 1000 }] })).toBe("pass")
    expect(
      core.demandHint({
        n: 2,
        listings: 1,
        apps: [
          { rating: 4.6, ratings_count: 50000 },
          { rating: 2, ratings_count: 999 },
        ],
      }),
    ).toBe("unknown")
  })

  it("exposes market data and the demand hint on opportunities", async () => {
    const sql = core.db()
    const [{ id: appId }] = await sql<{ id: string }[]>`select app_id::text as id from app_market where appllama_id = ${calm}`
    const [opp] = await sql<{ id: number }[]>`insert into opportunities (label, kind) values ('Offline mode', 'request') returning id`
    await sql`insert into opportunity_labels (label, opportunity_id) values ('offline mode', ${opp.id})`
    await sql`insert into reviews (app_id, review_id, rating, body, label, label_kind, analysis_version)
      values (${appId}, 'r1', 2, 'no offline', 'Offline mode', 'request', 1)`
    const o = (await core.getOpportunity(opp.id))!
    expect(o.market.map((m) => m.name)).toEqual(["Calm"])
    expect(o.market[0]).toMatchObject({ monthly_price: 14.99, annual_price: 49.99 })
    // Calm has 1.9M ratings at 3.7 stars
    expect(o.gate_hints.demand).toBe("pass")
    expect(core.marketPromptBlock(o.market).join("\n")).toMatch(
      /Calm: revenue \$4\.2M\/month, downloads 1\.2M, monthly price \$14\.99, annual price \$49\.99/,
    )
  })

  it("refuses calls at the local daily limit and resets on a new day", async () => {
    await core.saveSettings("appllama", { usage: { day: today(), calls: 390 } })
    const before = fake.calls.length
    await expect(core.appllamaSearch({})).rejects.toThrow(/daily limit nearly reached \(390\/400\)/)
    expect(fake.calls.length).toBe(before)
    await core.saveSettings("appllama", { usage: { day: "2000-01-01", calls: 399 } })
    await core.appllamaSearch({})
    expect((await settings()).usage).toEqual({ day: today(), calls: 1 })
  })

  it("disconnect revokes the refresh token and clears the tokens but keeps the client", async () => {
    const refresh = (await settings()).refreshToken
    await core.disconnectAppllama()
    expect(fake.revoked).toEqual([refresh])
    expect(await settings()).toMatchObject({
      accessToken: "",
      refreshToken: "",
      expiresAt: null,
      connectedAt: null,
      clientId: "client-1",
      clientSecret: "secret-1",
    })
    expect(core.appllamaConnected(await core.getSettings())).toBe(false)
    await expect(core.appllamaCredits()).rejects.toThrow(/not connected/i)
  })
})
