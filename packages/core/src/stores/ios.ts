import { fetchJson, sleep } from "./http"
import { StoreError, type AppRef, type StoreClient, type StoreListing, type StoreReview, type StoreSearchResult } from "./types"

/** Apple's public iTunes Search/Lookup API and customer-reviews RSS feed. No key required. */

interface ItunesApp {
  trackId: number
  trackName: string
  artistName?: string
  sellerName?: string
  primaryGenreName?: string
  description?: string
  releaseNotes?: string
  formattedPrice?: string
  price?: number
  currency?: string
  averageUserRating?: number
  userRatingCount?: number
  version?: string
  currentVersionReleaseDate?: string
  fileSizeBytes?: string
  contentAdvisoryRating?: string
  trackViewUrl?: string
  artworkUrl512?: string
  artworkUrl100?: string
  screenshotUrls?: string[]
  ipadScreenshotUrls?: string[]
}

interface RssLabel { label: string }
interface RssEntry {
  id?: RssLabel
  author?: { name?: RssLabel }
  "im:rating"?: RssLabel
  "im:version"?: RssLabel
  title?: RssLabel
  content?: RssLabel
  updated?: RssLabel
}

const BASE = process.env.ITUNES_BASE_URL ?? "https://itunes.apple.com"
const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v))

export function mapItunesApp(a: ItunesApp): StoreListing {
  return {
    storeId: String(a.trackId),
    name: a.trackName,
    developer: a.sellerName ?? a.artistName ?? null,
    category: a.primaryGenreName ?? null,
    description: a.description ?? null,
    releaseNotes: a.releaseNotes ?? null,
    price: a.formattedPrice ?? (a.price === 0 ? "Free" : null),
    priceValue: num(a.price),
    currency: a.currency ?? null,
    rating: num(a.averageUserRating),
    ratingsCount: num(a.userRatingCount),
    version: a.version ?? null,
    updatedAt: a.currentVersionReleaseDate ? new Date(a.currentVersionReleaseDate) : null,
    sizeBytes: num(a.fileSizeBytes),
    contentRating: a.contentAdvisoryRating ?? null,
    url: a.trackViewUrl ?? null,
    iconUrl: a.artworkUrl512 ?? a.artworkUrl100 ?? null,
    screenshots: [
      ...(a.screenshotUrls ?? []).map((url) => ({ url, device: "phone" as const })),
      ...(a.ipadScreenshotUrls ?? []).map((url) => ({ url, device: "tablet" as const })),
    ],
  }
}

export function mapRssEntries(entries: RssEntry[] | RssEntry | undefined): StoreReview[] {
  const list = Array.isArray(entries) ? entries : entries ? [entries] : []
  return list
    .filter((e) => e["im:rating"] && e.id?.label)
    .map((e) => ({
      id: e.id!.label,
      author: e.author?.name?.label ?? null,
      rating: num(e["im:rating"]?.label),
      title: e.title?.label ?? null,
      body: e.content?.label ?? null,
      version: e["im:version"]?.label ?? null,
      date: e.updated?.label ? new Date(e.updated.label) : null,
    }))
}

export const iosClient: StoreClient = {
  async listing(ref: AppRef) {
    const data = await fetchJson<{ resultCount: number; results: ItunesApp[] }>(
      `${BASE}/lookup?id=${encodeURIComponent(ref.storeId)}&country=${ref.country}&entity=software`,
    )
    const app = data.results.find((r) => String(r.trackId) === ref.storeId) ?? data.results[0]
    if (!app) throw new StoreError(`App ${ref.storeId} not found in the ${ref.country.toUpperCase()} App Store`, 404)
    return mapItunesApp(app)
  },

  async reviews(ref: AppRef, max: number) {
    // The RSS feed serves at most 10 pages of 50 reviews.
    const out: StoreReview[] = []
    for (let page = 1; page <= 10 && out.length < max; page++) {
      let feed: { feed?: { entry?: RssEntry[] | RssEntry } }
      try {
        feed = await fetchJson(`${BASE}/${ref.country}/rss/customerreviews/page=${page}/id=${ref.storeId}/sortby=mostrecent/json`)
      } catch (e) {
        if (page === 1) throw e
        break // later pages sometimes 400 when the feed runs out
      }
      const batch = mapRssEntries(feed.feed?.entry)
      if (!batch.length) break
      out.push(...batch)
      await sleep(400)
    }
    return out.slice(0, max)
  },

  async search(term, country, _lang, limit) {
    const data = await fetchJson<{ results: ItunesApp[] }>(
      `${BASE}/search?term=${encodeURIComponent(term)}&country=${country}&entity=software&limit=${limit}`,
    )
    return data.results.map<StoreSearchResult>((a) => ({
      store: "ios",
      storeId: String(a.trackId),
      name: a.trackName,
      developer: a.sellerName ?? a.artistName ?? null,
      iconUrl: a.artworkUrl100 ?? a.artworkUrl512 ?? null,
      rating: num(a.averageUserRating),
      url: a.trackViewUrl ?? null,
    }))
  },
}
