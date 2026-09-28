import { db } from "./db"
import { diffSnapshots, type SnapshotData } from "./diff"
import { downloadImage, storeImage, type StoredImage } from "./media"
import { getSettings } from "./settings"
import { storeClient as defaultClients, type Store, type StoreClient, type StoreReview } from "./stores"
import { withTimeout } from "./stores/http"

export interface SyncDeps {
  client?: (store: Store) => StoreClient
  fetchImage?: (url: string) => Promise<Buffer>
  reviewsPerApp?: number
  log?: (msg: string) => void
  /** Human-readable progress, e.g. "Downloading screenshots 4/20". */
  onProgress?: (message: string) => void
  imageConcurrency?: number
  /** Aborts the sync between steps (the worker uses it to enforce its job timeout). */
  signal?: AbortSignal
}

export interface SyncResult {
  name: string
  screenshots: number
  newScreenshots: number
  reviewsFetched: number
  newReviews: number
  changes: string[]
  warnings: string[]
  notes: string[]
  durationMs: number
}

/** Stored on apps.sync_report and shown on the app page. */
export type SyncReport = Omit<SyncResult, "name"> & { finishedAt: string; ok: boolean; error?: string }

interface AppRow {
  id: string
  store: Store
  store_id: string
  country: string
  lang: string
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      signal?.throwIfAborted()
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

/**
 * Pulls one app's listing, screenshots and reviews, stores them, and records
 * what changed since the previous snapshot. Database writes are batched so a
 * sync costs a handful of round trips regardless of how many reviews it saves.
 */
export async function syncApp(appId: string, deps: SyncDeps = {}): Promise<SyncResult> {
  const started = Date.now()
  const sql = db()
  const log = deps.log ?? (() => {})
  const signal = deps.signal
  const progress = (m: string) => {
    signal?.throwIfAborted()
    log(m)
    deps.onProgress?.(m)
  }
  const clientFor = deps.client ?? defaultClients
  const fetchImage = deps.fetchImage ?? downloadImage
  const warnings: string[] = []
  const notes: string[] = []
  const warn = (m: string) => {
    warnings.push(m)
    log(m)
  }

  const [app] = await sql<AppRow[]>`select id, store, store_id, country, lang from apps where id = ${appId}`
  if (!app) throw new Error(`App ${appId} does not exist`)
  if (app.store_id.startsWith("demo.") && !deps.client) {
    throw new Error("Demo app from `pnpm seed`: it is not in any store, so there is nothing to sync.")
  }
  const ref = { store: app.store, storeId: app.store_id, country: app.country, lang: app.lang }
  const client = clientFor(app.store)
  const max = deps.reviewsPerApp ?? (await getSettings()).sync.reviewsPerApp
  await sql`update apps set status = 'syncing' where id = ${appId}`

  try {
    progress("Fetching the store listing")
    const listing = await withTimeout(client.listing(ref), 60_000, "Store listing")

    // Reviews are fetched while images download: they are independent.
    let reviewsDone = 0
    const reviewsPromise = withTimeout(
      client.reviews(ref, max, {
        note: (m) => notes.push(m),
        progress: (done) => {
          reviewsDone = done
        },
      }),
      10 * 60_000,
      "Reviews",
    ).then(
      (r) => ({ ok: true as const, reviews: r }),
      (e: Error) => ({ ok: false as const, error: e.message }),
    )

    // Icon + screenshots, downloaded in parallel. Known source URLs are skipped.
    const known = new Map(
      (
        await sql<{ url: string; hash: string }[]>`
          select source_url as url, hash from screenshots where app_id = ${appId}
          union all select unnest(alt_urls), hash from screenshots where app_id = ${appId}`
      ).map((r) => [r.url, r.hash]),
    )
    const toDownload = listing.screenshots.filter((s) => !known.has(s.url))
    let downloaded = 0
    const report = () =>
      progress(`Downloading screenshots ${downloaded}/${toDownload.length}` + (reviewsDone ? ` · reviews ${reviewsDone}/${max}` : ""))
    if (toDownload.length) report()

    const [icon, ...images] = await mapLimit<{ url: string | null; folder: string; icon?: boolean }, StoredImage | Error | null>(
      [
        { url: listing.iconUrl, folder: `${appId}/icon`, icon: true },
        ...toDownload.map((s) => ({ url: s.url, folder: `${appId}/screens` })),
      ],
      deps.imageConcurrency ?? 6,
      async (job) => {
        if (!job.url) return null
        try {
          return await storeImage(await fetchImage(job.url), job.folder, job.icon ? { maxWidth: 256 } : {})
        } catch (e) {
          return e as Error
        } finally {
          if (!job.icon) {
            downloaded++
            report()
          }
        }
      },
      signal,
    )
    if (icon instanceof Error) warn(`Icon download failed: ${icon.message}`)
    const iconImg = icon instanceof Error ? null : icon

    const newRows: {
      app_id: string
      hash: string
      path: string
      source_url: string
      width: number | null
      height: number | null
      position: number
      device: string
      active: boolean
    }[] = []
    let failedScreenshots = 0
    const downloadedPairs: { url: string; hash: string }[] = []
    toDownload.forEach((shot, i) => {
      const img = images[i]
      if (img instanceof Error || !img) {
        failedScreenshots++
        warn(`Screenshot download failed: ${img instanceof Error ? img.message : "no data"}`)
        return
      }
      known.set(shot.url, img.hash)
      downloadedPairs.push({ url: shot.url, hash: img.hash })
      // The same image can appear under two URLs (e.g. iPhone and iPad); store it once.
      if (newRows.some((r) => r.hash === img.hash)) return
      newRows.push({
        app_id: appId,
        hash: img.hash,
        path: img.path,
        source_url: shot.url,
        width: img.width,
        height: img.height,
        position: 0,
        device: shot.device,
        active: false,
      })
    })
    let newScreenshots = 0
    if (newRows.length) {
      const inserted = await sql`
        insert into screenshots ${sql(newRows)}
        on conflict (app_id, hash) do nothing
        returning 1`
      newScreenshots = inserted.length
    }
    // Remember every URL an image was seen under, so identical images listed
    // twice (e.g. iPhone and iPad) are not downloaded again on the next sync.
    if (downloadedPairs.length) {
      await sql`
        update screenshots s set alt_urls = array_append(s.alt_urls, v.url)
        from unnest(${downloadedPairs.map((p) => p.url)}::text[], ${downloadedPairs.map((p) => p.hash)}::text[]) as v(url, hash)
        where s.app_id = ${appId} and s.hash = v.hash and s.source_url <> v.url and not (v.url = any(s.alt_urls))`
    }
    const current: string[] = []
    for (const s of listing.screenshots) {
      const h = known.get(s.url)
      if (h && !current.includes(h)) current.push(h)
    }

    // A partial download is not a store change: keep the previous set until a clean
    // run (on the very first sync, show whatever did download).
    const screenshotsComplete = failedScreenshots === 0
    const firstSync = !(await sql`select 1 from snapshots where app_id = ${appId} limit 1`).length
    if (current.length && (screenshotsComplete || firstSync)) {
      await sql`update screenshots set active = false where app_id = ${appId} and active and hash <> all(${current}::text[])`
      await sql`
        update screenshots s set active = true, position = (v.ord - 1)::int, last_seen_at = now()
        from unnest(${current}::text[]) with ordinality as v(hash, ord)
        where s.app_id = ${appId} and s.hash = v.hash`
    }

    // Reviews
    signal?.throwIfAborted()
    const rev = await reviewsPromise
    let newReviews = 0
    let reviewsFetched = 0
    if (rev.ok) {
      reviewsFetched = rev.reviews.length
      progress(`Saving ${rev.reviews.length} reviews`)
      newReviews = await upsertReviews(appId, rev.reviews)
      if (!rev.reviews.length) warn("The store returned no reviews for this app and country.")
    } else {
      warn(`Reviews could not be fetched: ${rev.error}`)
    }

    // Snapshot + change detection
    progress("Comparing with the last snapshot")
    const [prev] = await sql<{ data: SnapshotData }[]>`select data from snapshots where app_id = ${appId} order by taken_at desc limit 1`
    const snapshot: SnapshotData = {
      name: listing.name,
      description: listing.description,
      releaseNotes: listing.releaseNotes,
      price: listing.price,
      version: listing.version,
      iconHash: iconImg?.hash ?? prev?.data.iconHash ?? null,
      screenshots: screenshotsComplete || !prev ? current : prev.data.screenshots,
    }
    const changes = prev ? diffSnapshots(prev.data, snapshot) : []
    const result: SyncResult = {
      name: listing.name,
      screenshots: snapshot.screenshots.length,
      newScreenshots,
      reviewsFetched,
      newReviews,
      changes: changes.map((c) => c.summary),
      warnings,
      notes,
      durationMs: Date.now() - started,
    }
    const syncReport: SyncReport = { ...withoutName(result), ok: true, finishedAt: new Date().toISOString() }

    await sql.begin(async (tx) => {
      for (const c of changes) {
        await tx`insert into changes (app_id, field, old_value, new_value, summary)
          values (${appId}, ${c.field}, ${tx.json((c.oldValue ?? null) as never)}, ${tx.json((c.newValue ?? null) as never)}, ${c.summary})`
      }
      if (!prev || changes.length) {
        await tx`insert into snapshots (app_id, data) values (${appId}, ${tx.json(snapshot as never)})`
      }
      await tx`
        insert into rating_history (app_id, day, rating, ratings_count)
        values (${appId}, current_date, ${listing.rating}, ${listing.ratingsCount})
        on conflict (app_id, day) do update set rating = excluded.rating, ratings_count = excluded.ratings_count`
      await tx`
        update apps set
          name = ${listing.name}, developer = ${listing.developer}, category = ${listing.category},
          description = ${listing.description}, release_notes = ${listing.releaseNotes},
          price = ${listing.price}, price_value = ${listing.priceValue}, currency = ${listing.currency},
          rating = ${listing.rating}, ratings_count = ${listing.ratingsCount}, version = ${listing.version},
          updated_at_store = ${listing.updatedAt}, size_bytes = ${listing.sizeBytes},
          content_rating = ${listing.contentRating}, store_url = ${listing.url},
          icon_path = coalesce(${iconImg?.path ?? null}, icon_path),
          status = 'ready', last_error = null, last_synced_at = now(),
          sync_report = ${tx.json(syncReport as never)}
        where id = ${appId}`
    })
    log(`synced in ${result.durationMs} ms`)
    return result
  } catch (e) {
    const message = (e as Error).message
    const syncReport: SyncReport = {
      screenshots: 0,
      newScreenshots: 0,
      reviewsFetched: 0,
      newReviews: 0,
      changes: [],
      warnings,
      notes,
      durationMs: Date.now() - started,
      ok: false,
      error: message,
      finishedAt: new Date().toISOString(),
    }
    await sql`update apps set status = 'error', last_error = ${message}, sync_report = ${sql.json(syncReport as never)} where id = ${appId}`
    throw e
  }
}

const withoutName = ({ name: _name, ...rest }: SyncResult) => rest

/** Upserts reviews in batches; returns how many were new. */
export async function upsertReviews(appId: string, reviews: StoreReview[]) {
  const sql = db()
  const seen = new Set<string>()
  const rows = reviews
    .filter((r) => r.id && !seen.has(r.id) && seen.add(r.id))
    .map((r) => ({
      app_id: appId,
      review_id: r.id,
      author: r.author,
      rating: r.rating,
      title: r.title,
      body: r.body,
      app_version: r.version,
      reviewed_at: r.date && !Number.isNaN(r.date.getTime()) ? r.date : null,
    }))
  let inserted = 0
  for (const part of chunk(rows, 250)) {
    const res = await sql<{ inserted: boolean }[]>`
      insert into reviews ${sql(part)}
      on conflict (app_id, review_id) do update set
        rating = excluded.rating, title = excluded.title, body = excluded.body,
        app_version = coalesce(excluded.app_version, reviews.app_version),
        analysed_at = case when reviews.body is distinct from excluded.body then null else reviews.analysed_at end
      where reviews.rating is distinct from excluded.rating
         or reviews.title is distinct from excluded.title
         or reviews.body is distinct from excluded.body
      returning (xmax = 0) as inserted`
    inserted += res.filter((r) => r.inserted).length
  }
  return inserted
}
