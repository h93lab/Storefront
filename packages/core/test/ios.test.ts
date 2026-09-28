import { afterEach, describe, expect, it, vi } from "vitest"
import { iosClient, mapItunesApp, mapRssEntries } from "../src/stores/ios"
import { parseSize } from "../src/stores/android"

const lookup = {
  resultCount: 1,
  results: [{
    trackId: 571800810, trackName: "Calm", sellerName: "Calm.com, Inc.", primaryGenreName: "Health & Fitness",
    description: "Sleep more.", releaseNotes: "Fixes", formattedPrice: "Free", price: 0, currency: "USD",
    averageUserRating: 4.8, userRatingCount: 1900000, version: "6.52", currentVersionReleaseDate: "2026-09-22T10:00:00Z",
    fileSizeBytes: "252706816", contentAdvisoryRating: "4+", trackViewUrl: "https://apps.apple.com/us/app/calm/id571800810",
    artworkUrl512: "https://is1.example/icon.png", screenshotUrls: ["https://is1.example/1.png", "https://is1.example/2.png"],
    ipadScreenshotUrls: ["https://is1.example/ipad1.png"],
  }],
}

const rss = (n: number, offset = 0) => ({
  feed: {
    entry: Array.from({ length: n }, (_, i) => ({
      id: { label: `r${offset + i}` }, author: { name: { label: "Sam" } }, "im:rating": { label: "4" },
      "im:version": { label: "6.52" }, title: { label: "Nice" }, content: { label: "Good app" }, updated: { label: "2026-09-20T08:00:00-07:00" },
    })),
  },
})

afterEach(() => vi.unstubAllGlobals())

describe("iOS mapping", () => {
  it("maps lookup results", () => {
    const l = mapItunesApp(lookup.results[0])
    expect(l).toMatchObject({ storeId: "571800810", name: "Calm", developer: "Calm.com, Inc.", price: "Free", priceValue: 0, rating: 4.8, sizeBytes: 252706816 })
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
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes("/lookup")) return new Response(JSON.stringify(lookup))
      const page = Number(url.match(/page=(\d+)/)![1])
      return new Response(JSON.stringify(page <= 2 ? rss(50, (page - 1) * 50) : { feed: {} }))
    }))
    const ref = { store: "ios" as const, storeId: "571800810", country: "eg", lang: "en" }
    expect((await iosClient.listing(ref)).name).toBe("Calm")
    expect(calls[0]).toContain("country=eg")
    const reviews = await iosClient.reviews(ref, 500)
    expect(reviews).toHaveLength(100)
    expect(new Set(reviews.map((r) => r.id)).size).toBe(100)
    expect(calls.some((c) => c.includes("/eg/rss/customerreviews/page=3/id=571800810/sortby=mostrecent/json"))).toBe(true)
  })
  it("respects the review limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rss(50)))))
    const reviews = await iosClient.reviews({ store: "ios", storeId: "1", country: "us", lang: "en" }, 70)
    expect(reviews).toHaveLength(70)
  })
  it("reports missing apps clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ resultCount: 0, results: [] }))))
    await expect(iosClient.listing({ store: "ios", storeId: "1", country: "us", lang: "en" })).rejects.toThrow(/not found/)
  })
})
