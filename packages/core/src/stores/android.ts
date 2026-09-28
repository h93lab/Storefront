import gplay from "google-play-scraper"
import { StoreError, type AppRef, type StoreClient, type StoreListing, type StoreReview } from "./types"

/**
 * Google Play has no public API; google-play-scraper parses the store pages.
 * If Google changes the page layout this can break until the library is updated.
 */

const SIZE_UNITS: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9 }
export function parseSize(size?: string | null): number | null {
  const m = size?.match(/([\d.]+)\s*([KMG])/i)
  return m ? Math.round(parseFloat(m[1]) * SIZE_UNITS[m[2].toUpperCase()]) : null
}

function wrap(e: unknown, ref: AppRef): never {
  const err = e as { status?: number; message?: string }
  if (err?.status === 404 || /404/.test(err?.message ?? "")) {
    throw new StoreError(`App ${ref.storeId} not found on Google Play (${ref.country.toUpperCase()})`, 404)
  }
  throw new StoreError(`Google Play request failed: ${err?.message ?? String(e)}`, err?.status)
}

export const androidClient: StoreClient = {
  async listing(ref: AppRef): Promise<StoreListing> {
    let a
    try {
      a = await gplay.app({ appId: ref.storeId, country: ref.country, lang: ref.lang })
    } catch (e) {
      wrap(e, ref)
    }
    const d = a as typeof a & { size?: string; screenshots?: string[]; genre?: string; contentRating?: string; updated?: number; version?: string; recentChanges?: string }
    return {
      storeId: d.appId,
      name: d.title,
      developer: d.developer ?? null,
      category: d.genre ?? null,
      description: d.description ?? null,
      releaseNotes: d.recentChanges ?? null,
      price: d.free ? "Free" : (d.priceText ?? null),
      priceValue: d.price ?? null,
      currency: d.currency ?? null,
      rating: d.score ?? null,
      ratingsCount: d.ratings ?? null,
      version: d.version && d.version !== "VARY" ? d.version : null,
      updatedAt: d.updated ? new Date(d.updated) : null,
      sizeBytes: parseSize(d.size),
      contentRating: d.contentRating ?? null,
      url: d.url ?? null,
      iconUrl: d.icon ?? null,
      screenshots: (d.screenshots ?? []).map((url) => ({ url, device: "phone" as const })),
    }
  },

  async reviews(ref: AppRef, max: number): Promise<StoreReview[]> {
    const out: StoreReview[] = []
    let token: string | undefined
    try {
      while (out.length < max) {
        const res = await gplay.reviews({
          appId: ref.storeId,
          country: ref.country,
          lang: ref.lang,
          sort: 2 /* NEWEST */,
          num: Math.min(150, max - out.length),
          paginate: true,
          nextPaginationToken: token,
        })
        out.push(
          ...res.data.map((r) => ({
            id: r.id,
            author: r.userName ?? null,
            rating: r.score ?? null,
            title: r.title ?? null,
            body: r.text ?? null,
            version: r.version ?? null,
            date: r.date ? new Date(r.date) : null,
          })),
        )
        token = res.nextPaginationToken
        if (!token || !res.data.length) break
      }
    } catch (e) {
      if (!out.length) wrap(e, ref)
    }
    return out.slice(0, max)
  },

  async search(term, country, lang, limit) {
    const res = await gplay.search({ term, country, lang, num: limit })
    return res.map((a) => ({
      store: "android" as const,
      storeId: a.appId,
      name: a.title,
      developer: a.developer ?? null,
      iconUrl: a.icon ?? null,
      rating: a.score ?? null,
      url: a.url ?? null,
    }))
  },
}
