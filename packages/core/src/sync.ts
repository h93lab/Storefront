import { db } from "./db"
import { diffSnapshots, type SnapshotData } from "./diff"
import { downloadImage, storeImage } from "./media"
import { getSettings } from "./settings"
import { storeClient as defaultClients, type Store, type StoreClient } from "./stores"

export interface SyncDeps {
  client?: (store: Store) => StoreClient
  fetchImage?: (url: string) => Promise<Buffer>
  reviewsPerApp?: number
  log?: (msg: string) => void
}

export interface SyncResult {
  name: string
  screenshots: number
  newScreenshots: number
  newReviews: number
  changes: string[]
  warnings: string[]
}

interface AppRow {
  id: string
  store: Store
  store_id: string
  country: string
  lang: string
}

/**
 * Pulls one app's listing, screenshots and reviews, stores them, and records
 * what changed since the previous snapshot.
 */
export async function syncApp(appId: string, deps: SyncDeps = {}): Promise<SyncResult> {
  const sql = db()
  const log = deps.log ?? (() => {})
  const clientFor = deps.client ?? defaultClients
  const fetchImage = deps.fetchImage ?? downloadImage
  const warnings: string[] = []
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
  await sql`update apps set status = 'syncing' where id = ${appId}`

  try {
    const listing = await client.listing(ref)
    log(`listing ok: ${listing.name}`)

    // Icon
    let iconPath: string | null = null
    let iconHash: string | null = null
    if (listing.iconUrl) {
      try {
        const img = await storeImage(await fetchImage(listing.iconUrl), `${appId}/icon`, { maxWidth: 256 })
        iconPath = img.path
        iconHash = img.hash
      } catch (e) {
        warn(`Icon download failed: ${(e as Error).message}`)
      }
    }

    // Screenshots: reuse known source URLs, download new ones.
    const known = new Map(
      (await sql<{ source_url: string; hash: string }[]>`select source_url, hash from screenshots where app_id = ${appId}`).map((r) => [
        r.source_url,
        r.hash,
      ]),
    )
    const current: string[] = []
    let newScreenshots = 0
    let failedScreenshots = 0
    for (const [position, shot] of listing.screenshots.entries()) {
      let hash = known.get(shot.url)
      if (!hash) {
        try {
          const img = await storeImage(await fetchImage(shot.url), `${appId}/screens`)
          hash = img.hash
          const inserted = await sql`
            insert into screenshots (app_id, hash, path, source_url, width, height, position, device, active)
            values (${appId}, ${img.hash}, ${img.path}, ${shot.url}, ${img.width}, ${img.height}, ${position}, ${shot.device}, false)
            on conflict (app_id, hash) do update set source_url = excluded.source_url
            returning (xmax = 0) as inserted`
          if (inserted[0]?.inserted) newScreenshots++
        } catch (e) {
          warn(`Screenshot ${position + 1} download failed: ${(e as Error).message}`)
          failedScreenshots++
          continue
        }
      }
      if (!current.includes(hash)) current.push(hash)
    }
    // A partial download is not a store change: keep the previous set until a clean
    // run (on the very first sync, show whatever did download).
    const screenshotsComplete = failedScreenshots === 0
    if (current.length && (screenshotsComplete || known.size === 0)) {
      await sql`update screenshots set active = false where app_id = ${appId} and hash <> all(${current})`
      for (const [position, hash] of current.entries()) {
        await sql`update screenshots set active = true, position = ${position}, last_seen_at = now() where app_id = ${appId} and hash = ${hash}`
      }
    }

    // Reviews
    const max = deps.reviewsPerApp ?? (await getSettings()).sync.reviewsPerApp
    let newReviews = 0
    try {
      const reviews = await client.reviews(ref, max)
      for (const r of reviews) {
        const res = await sql`
          insert into reviews (app_id, review_id, author, rating, title, body, app_version, reviewed_at)
          values (${appId}, ${r.id}, ${r.author}, ${r.rating}, ${r.title}, ${r.body}, ${r.version}, ${r.date})
          on conflict (app_id, review_id) do update set
            rating = excluded.rating, title = excluded.title, body = excluded.body,
            analysed_at = case when reviews.body is distinct from excluded.body then null else reviews.analysed_at end
          returning (xmax = 0) as inserted`
        if (res[0]?.inserted) newReviews++
      }
      log(`reviews ok: ${reviews.length} fetched, ${newReviews} new`)
    } catch (e) {
      warn(`Reviews could not be fetched: ${(e as Error).message}`)
    }

    // Snapshot + change detection
    const [prev] = await sql<{ data: SnapshotData }[]>`select data from snapshots where app_id = ${appId} order by taken_at desc limit 1`
    const snapshot: SnapshotData = {
      name: listing.name,
      description: listing.description,
      releaseNotes: listing.releaseNotes,
      price: listing.price,
      version: listing.version,
      iconHash: iconHash ?? prev?.data.iconHash ?? null,
      screenshots: screenshotsComplete || !prev ? current : prev.data.screenshots,
    }
    const changes = prev ? diffSnapshots(prev.data, snapshot) : []
    for (const c of changes) {
      await sql`insert into changes (app_id, field, old_value, new_value, summary)
        values (${appId}, ${c.field}, ${sql.json((c.oldValue ?? null) as never)}, ${sql.json((c.newValue ?? null) as never)}, ${c.summary})`
    }
    if (!prev || changes.length) {
      await sql`insert into snapshots (app_id, data) values (${appId}, ${sql.json(snapshot as never)})`
    }

    await sql`
      insert into rating_history (app_id, day, rating, ratings_count)
      values (${appId}, current_date, ${listing.rating}, ${listing.ratingsCount})
      on conflict (app_id, day) do update set rating = excluded.rating, ratings_count = excluded.ratings_count`

    await sql`
      update apps set
        name = ${listing.name}, developer = ${listing.developer}, category = ${listing.category},
        description = ${listing.description}, release_notes = ${listing.releaseNotes},
        price = ${listing.price}, price_value = ${listing.priceValue}, currency = ${listing.currency},
        rating = ${listing.rating}, ratings_count = ${listing.ratingsCount}, version = ${listing.version},
        updated_at_store = ${listing.updatedAt}, size_bytes = ${listing.sizeBytes},
        content_rating = ${listing.contentRating}, store_url = ${listing.url},
        icon_path = coalesce(${iconPath}, icon_path),
        status = 'ready', last_error = null, last_synced_at = now()
      where id = ${appId}`

    return {
      name: listing.name,
      screenshots: screenshotsComplete ? current.length : snapshot.screenshots.length,
      newScreenshots,
      newReviews,
      changes: changes.map((c) => c.summary),
      warnings,
    }
  } catch (e) {
    await sql`update apps set status = 'error', last_error = ${(e as Error).message} where id = ${appId}`
    throw e
  }
}
