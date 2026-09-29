import http from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/** Reddit fetcher against a fake token + search server. Needs TEST_DATABASE_URL (the database is wiped). */
const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

let server: http.Server
let base = ""
let hits: { path: string; auth?: string; ua?: string }[] = []
let tokenStatus = 200

const posts = [
  {
    id: "a1",
    title: "Need offline mode",
    selftext: "I fly a lot and the app dies offline",
    permalink: "/r/sleep/comments/a1/x/",
    author: "u1",
    created_utc: 1_780_000_000,
  },
  { id: "a2", title: "Link post", selftext: "", permalink: "/r/sleep/comments/a2/y/", author: "u2", created_utc: 1_780_000_100 },
]

suite("reddit", () => {
  let core: typeof import("../src/index")

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    core = await import("../src/index")
    await core.db().unsafe("drop schema public cascade; create schema public;")
    await (await import("../src/migrate")).migrate(() => {})
    server = http.createServer((req, res) => {
      hits.push({ path: req.url ?? "", auth: req.headers.authorization, ua: req.headers["user-agent"] })
      res.setHeader("content-type", "application/json")
      if (req.url?.startsWith("/api/v1/access_token")) {
        res.statusCode = tokenStatus
        return res.end(JSON.stringify({ access_token: "tok" }))
      }
      res.end(JSON.stringify({ data: { children: posts.map((data) => ({ data })) } }))
    })
    await new Promise<void>((r) => server.listen(0, r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  afterAll(async () => {
    server?.close()
    if (core) await core.closeDb()
  })

  const configure = (patch: Partial<import("../src/settings").Settings["reddit"]>) =>
    core.saveSettings("reddit", {
      enabled: true,
      clientId: "id",
      clientSecret: "secret",
      userAgent: "lens-test/1.0",
      subreddits: ["sleep"],
      keywords: ["offline"],
      apiBase: base,
      ...patch,
    })

  it("does nothing when disabled", async () => {
    await configure({ enabled: false })
    hits = []
    expect(await core.fetchReddit()).toEqual({ fetched: 0, inserted: 0, skipped: 0 })
    expect(hits).toHaveLength(0)
  })

  it("imports posts with text, then dedupes", async () => {
    await configure({})
    hits = []
    const first = await core.fetchReddit()
    expect(first).toMatchObject({ fetched: 2, inserted: 1 })
    expect(hits[0].auth).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`)
    expect(hits[0].ua).toBe("lens-test/1.0")
    expect(hits[1].path).toContain("/r/sleep/search?")
    expect(hits[1].path).toContain("restrict_sr=1")
    expect(hits[1].path).toContain("sort=new")
    expect(hits[1].auth).toBe("Bearer tok")
    const [item] = await core.db()<{ source: string; url: string; author: string; body: string; posted_at: Date }[]>`
      select source, url, author, body, posted_at from items`
    expect(item).toMatchObject({ source: "reddit", url: "https://www.reddit.com/r/sleep/comments/a1/x/", author: "u1" })
    expect(item.body).toBe("Need offline mode\n\nI fly a lot and the app dies offline")
    expect(item.posted_at.getTime()).toBe(1_780_000_000_000)
    expect((await core.activeJobs()).map((j) => j.type)).toContain("analyse_items")

    const second = await core.fetchReddit()
    expect(second.inserted).toBe(0)
  })

  it("explains a refused token", async () => {
    await configure({})
    tokenStatus = 401
    await expect(core.fetchReddit()).rejects.toThrow(/Reddit refused the credentials/)
    tokenStatus = 200
  })
})
