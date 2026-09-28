import { afterEach, describe, expect, it, vi } from "vitest"
import { iosClient, mapItunesApp, mapRssEntries } from "../src/stores/ios"
import { parseSize } from "../src/stores/android"

const lookup = {
  resultCount: 1,
  results: [
    {
      trackId: 571800810,
      trackName: "Calm",
      sellerName: "Calm.com, Inc.",
      primaryGenreName: "Health & Fitness",
      description: "Sleep more.",
      releaseNotes: "Fixes",
      formattedPrice: "Free",
      price: 0,
      currency: "USD",
      averageUserRating: 4.8,
      userRatingCount: 1900000,
      version: "6.52",
      currentVersionReleaseDate: "2026-09-22T10:00:00Z",
      fileSizeBytes: "252706816",
      contentAdvisoryRating: "4+",
      trackViewUrl: "https://apps.apple.com/us/app/calm/id571800810",
      artworkUrl512: "https://is1.example/icon.png",
      screenshotUrls: ["https://is1.example/1.png", "https://is1.example/2.png"],
      ipadScreenshotUrls: ["https://is1.example/ipad1.png"],
    },
  ],
}

const rss = (n: number, offset = 0) => ({
  feed: {
    entry: Array.from({ length: n }, (_, i) => ({
      id: { label: `r${offset + i}` },
      author: { name: { label: "Sam" } },
      "im:rating": { label: "4" },
      "im:version": { label: "6.52" },
      title: { label: "Nice" },
      content: { label: "Good app" },
      updated: { label: "2026-09-20T08:00:00-07:00" },
    })),
  },
})

afterEach(() => vi.unstubAllGlobals())

describe("iOS mapping", () => {
  it("maps lookup results", () => {
    const l = mapItunesApp(lookup.results[0])
    expect(l).toMatchObject({
      storeId: "571800810",
      name: "Calm",
      developer: "Calm.com, Inc.",
      price: "Free",
      priceValue: 0,
      rating: 4.8,
      sizeBytes: 252706816,
    })
    expect(l.screenshots).toEqual([
      { url: "https://is1.example/1.png", device: "phone" },
      { url: "https://is1.example/2.png", device: "phone" },
      { url: "https://is1.example/ipad1.png", device: "tablet" },
    ])
  })
  it("maps RSS entries and skips non-review entries", () => {
    const out = mapRssEntries([{ id: { label: "meta" }, title: { label: "Calm" } }, ...rss(2).feed.entry])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: "r0", rating: 4, title: "Nice", body: "Good app", version: "6.52" })
    expect(mapRssEntries(rss(1).feed.entry[0])).toHaveLength(1)
    expect(mapRssEntries(undefined)).toEqual([])
  })
  it("parses Play sizes", () => {
    expect(parseSize("42M")).toBe(42_000_000)
    expect(parseSize("1.5 G")).toBe(1_500_000_000)
    expect(parseSize("Varies with device")).toBeNull()
  })
})

describe("iosClient over HTTP", () => {
  it("fetches listing and pages reviews until the feed runs out", async () => {
    const calls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url)
        if (url.includes("/lookup")) return new Response(JSON.stringify(lookup))
        const page = Number(url.match(/page=(\d+)/)![1])
        return new Response(JSON.stringify(page <= 2 ? rss(50, (page - 1) * 50) : { feed: {} }))
      }),
    )
    const ref = { store: "ios" as const, storeId: "571800810", country: "eg", lang: "en" }
    expect((await iosClient.listing(ref)).name).toBe("Calm")
    expect(calls[0]).toContain("country=eg")
    const reviews = await iosClient.reviews(ref, 500)
    expect(reviews).toHaveLength(100)
    expect(new Set(reviews.map((r) => r.id)).size).toBe(100)
    expect(calls.some((c) => c.includes("/eg/rss/customerreviews/page=3/id=571800810/sortby=mostrecent/json"))).toBe(true)
  })
  it("respects the review limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(rss(50)))),
    )
    const reviews = await iosClient.reviews({ store: "ios", storeId: "1", country: "us", lang: "en" }, 70)
    expect(reviews).toHaveLength(70)
  })
  it("reports missing apps clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ resultCount: 0, results: [] }))),
    )
    await expect(iosClient.listing({ store: "ios", storeId: "1", country: "us", lang: "en" })).rejects.toThrow(/not found/)
  })
})

describe("App Store reviews fallback", () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const token = `${b64({ alg: "ES256", kid: "WebPlay" })}.${b64({ iss: "x", exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`
  const expired = `${b64({ alg: "ES256" })}.${b64({ exp: 1000 })}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`
  const amp = (n: number, offset: number, more: boolean) => ({
    data: Array.from({ length: n }, (_, i) => ({
      id: `w${offset + i}`,
      type: "user-reviews",
      attributes: { date: "2026-09-20T10:00:00Z", title: "T", review: "Body", rating: 5, userName: "u" },
    })),
    next: more ? `/v1/catalog/tr/apps/1/reviews?offset=${offset + n}` : undefined,
  })
  const ref = { store: "ios" as const, storeId: "1", country: "tr", lang: "tr" }

  it("finds only unexpired tokens", async () => {
    const { findToken } = await import("../src/stores/ios")
    expect(findToken(`<meta content="%7B%22token%22%3A%22${expired}%22%7D"> ${token}`)).toBe(token)
    expect(findToken("nothing here")).toBeNull()
  })

  it("uses the web API when the RSS feed is empty, with token from a script bundle", async () => {
    const { iosClient, _resetTokenCache } = await import("../src/stores/ios")
    _resetTokenCache()
    const seen: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push(url)
        if (url.includes("/rss/")) return new Response(JSON.stringify({ feed: { author: {} } }))
        if (url.includes("apps.apple.com/tr/app/id1"))
          return new Response(`<html><script type="module" src="/assets/index-abc.js"></script></html>`)
        if (url.endsWith("/assets/index-abc.js")) return new Response(`const cfg={token:"${token}"}`)
        if (url.includes("/reviews?")) {
          expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`)
          const offset = Number(new URL(url).searchParams.get("offset"))
          return new Response(JSON.stringify(amp(20, offset, offset < 40)))
        }
        return new Response("", { status: 404 })
      }),
    )
    const notes: string[] = []
    const r = await iosClient.reviews(ref, 500, { note: (n) => notes.push(n) })
    expect(r).toHaveLength(60)
    expect(r[0]).toMatchObject({ id: "w0", rating: 5, title: "T", body: "Body", author: "u" })
    expect(notes.join(" ")).toMatch(/RSS feed returned no reviews.*web API: 60 reviews/)
    expect(seen.find((u) => u.includes("/reviews?"))).toContain("l=tr")
  })

  it("prefers the RSS feed when it has reviews", async () => {
    const { iosClient, _resetTokenCache } = await import("../src/stores/ios")
    _resetTokenCache()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("page=1/") ? new Response(JSON.stringify(rss(5))) : new Response(JSON.stringify({ feed: {} })),
      ),
    )
    const notes: string[] = []
    expect(await iosClient.reviews(ref, 500, { note: (n) => notes.push(n) })).toHaveLength(5)
    expect(notes).toEqual(["App Store RSS feed: 5 reviews"])
  })

  it("reports both errors when every source fails", async () => {
    const { iosClient, _resetTokenCache } = await import("../src/stores/ios")
    _resetTokenCache()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    )
    await expect(iosClient.reviews(ref, 50)).rejects.toThrow(/RSS feed: HTTP 403.*web API: HTTP 403/)
  })
})
