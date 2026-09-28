import { fetchJson, fetchWithRetry, sleep } from "./http"
import {
  StoreError,
  type AppRef,
  type FetchContext,
  type StoreClient,
  type StoreListing,
  type StoreReview,
  type StoreSearchResult,
} from "./types"

/**
 * App Store data comes from three public sources, none of which needs a key:
 * - iTunes Search/Lookup API for the listing and search
 * - the customer-reviews RSS feed (up to 500 newest reviews per country)
 * - the web API that apps.apple.com itself uses, as a fallback for reviews
 *   when the RSS feed is empty or blocked
 */

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

interface RssLabel {
  label: string
}
interface RssEntry {
  id?: RssLabel
  author?: { name?: RssLabel }
  "im:rating"?: RssLabel
  "im:version"?: RssLabel
  title?: RssLabel
  content?: RssLabel
  updated?: RssLabel
}

interface AmpReview {
  id: string
  attributes?: { date?: string; title?: string; review?: string; rating?: number; userName?: string }
}

const BASE = process.env.ITUNES_BASE_URL ?? "https://itunes.apple.com"
const WEB = process.env.APPSTORE_WEB_URL ?? "https://apps.apple.com"
const AMP_HOSTS = (process.env.APPSTORE_AMP_HOSTS ?? "https://amp-api-edge.apps.apple.com,https://amp-api.apps.apple.com").split(",")
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

export function mapAmpReviews(data: AmpReview[] | undefined): StoreReview[] {
  return (data ?? [])
    .filter((r) => r.id && r.attributes)
    .map((r) => ({
      id: String(r.id),
      author: r.attributes!.userName ?? null,
      rating: num(r.attributes!.rating),
      title: r.attributes!.title ?? null,
      body: r.attributes!.review ?? null,
      version: null,
      date: r.attributes!.date ? new Date(r.attributes!.date) : null,
    }))
}

async function rssReviews(ref: AppRef, max: number, ctx?: FetchContext) {
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
    ctx?.progress?.(Math.min(out.length, max), max)
    await sleep(300)
  }
  return out.slice(0, max)
}

// ── apps.apple.com web API ──────────────────────────────────────────────────

let cachedToken: { value: string; expires: number } | null = null
const JWT = /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g

function jwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp?: number }
    return typeof payload.exp === "number" ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/** Finds the public bearer token the App Store website embeds in its page or scripts. */
export function findToken(text: string): string | null {
  for (const m of text.matchAll(JWT)) {
    const exp = jwtExpiry(m[0])
    if (exp && exp > Date.now()) return m[0]
  }
  return null
}

async function webToken(ref: AppRef): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 5 * 60_000) return cachedToken.value
  const pageUrl = `${WEB}/${ref.country}/app/id${ref.storeId}`
  const res = await fetchWithRetry(pageUrl, { headers: { accept: "text/html" } })
  if (!res.ok) throw new StoreError(`HTTP ${res.status} from apps.apple.com`, res.status)
  const html = await res.text()
  // JWT characters are URL-safe, so the token is findable even inside URL-encoded page config.
  let token = findToken(html)
  if (!token) {
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => new URL(m[1], WEB).toString()).slice(0, 8)
    for (const src of scripts) {
      const js = await fetchWithRetry(src).then((r) => (r.ok ? r.text() : ""))
      token = findToken(js)
      if (token) break
    }
  }
  if (!token) throw new StoreError("Could not find the App Store web token (the website may have changed)")
  cachedToken = { value: token, expires: jwtExpiry(token) ?? Date.now() + 6 * 3600_000 }
  return token
}

const LOCALES: Record<string, string> = { en: "en-US", ar: "ar", tr: "tr", fr: "fr-FR", de: "de-DE", es: "es-ES", pt: "pt-BR", ja: "ja" }

async function webReviews(ref: AppRef, max: number, ctx?: FetchContext) {
  const token = await webToken(ref)
  const headers = { authorization: `Bearer ${token}`, origin: WEB, referer: `${WEB}/`, accept: "application/json" }
  const locale = LOCALES[ref.lang] ?? ref.lang
  let lastError: unknown
  for (const host of AMP_HOSTS) {
    const out: StoreReview[] = []
    let offset = 0
    try {
      while (out.length < max) {
        const url =
          `${host}/v1/catalog/${ref.country}/apps/${ref.storeId}/reviews?l=${encodeURIComponent(locale)}` +
          `&offset=${offset}&limit=20&platform=web&additionalPlatforms=appletv%2Cipad%2Ciphone%2Cmac&sort=recent`
        const res = await fetchWithRetry(url, { headers })
        if (res.status === 401 || res.status === 403) {
          cachedToken = null
          throw new StoreError(`HTTP ${res.status} from ${new URL(host).hostname}`, res.status)
        }
        if (!res.ok) throw new StoreError(`HTTP ${res.status} from ${new URL(host).hostname}`, res.status)
        const body = (await res.json()) as { data?: AmpReview[]; next?: string }
        const batch = mapAmpReviews(body.data)
        out.push(...batch)
        ctx?.progress?.(Math.min(out.length, max), max)
        const next = body.next ? new URL(body.next, host).searchParams.get("offset") : null
        if (!batch.length || !next) break
        offset = Number(next)
        await sleep(250)
      }
      return out.slice(0, max)
    } catch (e) {
      if (out.length) return out.slice(0, max)
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new StoreError(String(lastError))
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

  async reviews(ref: AppRef, max: number, ctx?: FetchContext) {
    let rss: StoreReview[] = []
    let rssError: string | null = null
    try {
      rss = await rssReviews(ref, max, ctx)
    } catch (e) {
      rssError = (e as Error).message
    }
    if (rss.length) {
      ctx?.note?.(`App Store RSS feed: ${rss.length} reviews`)
      return rss
    }
    ctx?.note?.(
      rssError
        ? `App Store RSS feed failed (${rssError}), trying the App Store web API`
        : "App Store RSS feed returned no reviews, trying the App Store web API",
    )
    try {
      const web = await webReviews(ref, max, ctx)
      ctx?.note?.(`App Store web API: ${web.length} reviews`)
      return web
    } catch (e) {
      const webError = (e as Error).message
      if (rssError) throw new StoreError(`RSS feed: ${rssError}; web API: ${webError}`)
      ctx?.note?.(`App Store web API failed: ${webError}`)
      return [] // RSS worked and was genuinely empty
    }
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

/** Test hook */
export const _resetTokenCache = () => {
  cachedToken = null
}
