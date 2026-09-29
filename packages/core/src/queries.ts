import { ANALYSIS_VERSION } from "./analysis"
import { db } from "./db"
import type { Store } from "./stores"

export interface AppSummary {
  id: string
  store: Store
  store_id: string
  country: string
  lang: string
  name: string
  developer: string | null
  category: string | null
  rating: number | null
  ratings_count: number | null
  price: string | null
  version: string | null
  icon_path: string | null
  status: "pending" | "syncing" | "ready" | "error"
  own: boolean
  last_error: string | null
  last_synced_at: Date | null
  created_at: Date
  preview: string[]
  recent_change: string | null
}

export interface AppDetail extends AppSummary {
  description: string | null
  release_notes: string | null
  price_value: number | null
  currency: string | null
  updated_at_store: Date | null
  size_bytes: number | null
  content_rating: string | null
  store_url: string | null
  reviews_count: number
  screenshots_count: number
  sync_report: import("./sync").SyncReport | null
}

const appCols = (sql = db()) => sql`
  a.id, a.store, a.store_id, a.country, a.lang, a.name, a.developer, a.category,
  a.rating::float8 as rating, a.ratings_count::float8 as ratings_count, a.price, a.version, a.icon_path,
  a.status, a.last_error, a.last_synced_at, a.created_at, a.own,
  coalesce((select array_agg(path order by position) from (
    select path, position from screenshots s where s.app_id = a.id and s.active and s.device = 'phone' order by position limit 3) p), '{}') as preview,
  (select field from changes c where c.app_id = a.id and c.detected_at > now() - interval '7 days' order by detected_at desc limit 1) as recent_change`

export async function listApps(f: { q?: string; store?: Store | "all"; category?: string } = {}) {
  const sql = db()
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null
  return sql<AppSummary[]>`
    select ${appCols(sql)} from apps a
    where (${q}::text is null or a.name ilike ${q} or a.developer ilike ${q} or a.store_id ilike ${q})
      and (${f.store && f.store !== "all" ? f.store : null}::text is null or a.store = ${f.store ?? ""})
      and (${f.category && f.category !== "all" ? f.category : null}::text is null or a.category = ${f.category ?? ""})
    order by a.created_at desc`
}

export async function categories() {
  const rows = await db()<{ category: string }[]>`select distinct category from apps where category is not null order by 1`
  return rows.map((r) => r.category)
}

export async function getApp(id: string): Promise<AppDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const sql = db()
  const [row] = await sql<AppDetail[]>`
    select ${appCols(sql)}, a.description, a.release_notes, a.price_value::float8 as price_value, a.currency,
      a.updated_at_store, a.size_bytes::float8 as size_bytes, a.content_rating, a.store_url, a.sync_report,
      (select count(*)::int from reviews r where r.app_id = a.id) as reviews_count,
      (select count(*)::int from screenshots s where s.app_id = a.id and s.active) as screenshots_count
    from apps a where a.id = ${id}`
  return row ?? null
}

export interface Screenshot {
  id: string
  app_id: string
  hash: string
  path: string
  width: number | null
  height: number | null
  position: number
  device: string
  active: boolean
  first_seen_at: Date
  last_seen_at: Date
}

export async function getScreenshots(appId: string, opts: { includeInactive?: boolean } = {}) {
  return db()<Screenshot[]>`
    select id::text, app_id, hash, path, width, height, position, device, active, first_seen_at, last_seen_at
    from screenshots where app_id = ${appId} and (${opts.includeInactive ?? false} or active)
    order by active desc, device desc, position, first_seen_at desc`
}

export async function getScreenshotsByHashes(appId: string, hashes: string[]) {
  if (!hashes.length) return []
  const rows = await db()<(Screenshot & { hash: string })[]>`
    select id::text, app_id, hash, path, width, height, position, device, active, first_seen_at, last_seen_at
    from screenshots where app_id = ${appId} and hash = any(${hashes})`
  const byHash = new Map(rows.map((r) => [r.hash, r]))
  return hashes.map((h) => byHash.get(h)).filter((x): x is Screenshot & { hash: string } => Boolean(x))
}

/** Paths for many (app, hash) pairs in one query; key is `${appId}:${hash}`. */
export async function screenshotPaths(pairs: { appId: string; hash: string }[]) {
  const map = new Map<string, string>()
  if (!pairs.length) return map
  const rows = await db()<{ app_id: string; hash: string; path: string }[]>`
    select app_id, hash, path from screenshots
    where (app_id::text, hash) in (select * from unnest(${pairs.map((p) => p.appId)}::text[], ${pairs.map((p) => p.hash)}::text[]))`
  for (const r of rows) map.set(`${r.app_id}:${r.hash}`, r.path)
  return map
}

export async function getScreenshot(id: string) {
  if (!/^\d+$/.test(id)) return null
  const [row] = await db()<(Screenshot & { app_name: string })[]>`
    select s.id::text, s.app_id, s.path, s.width, s.height, s.position, s.device, s.active, s.first_seen_at, s.last_seen_at, a.name as app_name
    from screenshots s join apps a on a.id = s.app_id where s.id = ${id}`
  return row ?? null
}

export interface Review {
  app_id: string
  review_id: string
  author: string | null
  rating: number | null
  title: string | null
  body: string | null
  app_version: string | null
  reviewed_at: Date | null
  sentiment: "positive" | "neutral" | "negative" | null
  topic: string | null
  label: string | null
  label_kind: string | null
  wtp_signal: string | null
  competitor_mentioned: string | null
  workaround: string | null
  evidence_span: string | null
  pain_score: number | null
}

const REVIEW_COLS = `app_id, review_id, author, rating, title, body, app_version, reviewed_at, sentiment, topic, label, label_kind,
  wtp_signal, competitor_mentioned, workaround, evidence_span, pain_score`

export type RatingFilter = "all" | "pos" | "neu" | "neg"
export interface ReviewQuery {
  rating?: RatingFilter
  q?: string
  topic?: string | null
  sentiment?: string | null
  /** A wtp_signal value, or "any" for every review with a signal other than none. */
  signal?: string | null
  sort?: "new" | "low" | "high"
  limit?: number
  offset?: number
}

export async function getReviews(appId: string, f: ReviewQuery = {}) {
  const sql = db()
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null
  const rating = f.rating ?? "all"
  const signal = f.signal ?? null
  const where = sql`
    app_id = ${appId}
    and (${rating} = 'all' or (${rating} = 'pos' and rating >= 4) or (${rating} = 'neu' and rating = 3) or (${rating} = 'neg' and rating <= 2))
    and (${q}::text is null or title ilike ${q} or body ilike ${q})
    and (${f.topic ?? null}::text is null or topic = ${f.topic ?? ""})
    and (${f.sentiment ?? null}::text is null or sentiment = ${f.sentiment ?? ""})
    and (${signal}::text is null or (${signal} = 'any' and wtp_signal is not null and wtp_signal <> 'none') or wtp_signal = ${signal ?? ""})`
  const order =
    f.sort === "low"
      ? sql`rating asc nulls last, reviewed_at desc`
      : f.sort === "high"
        ? sql`rating desc nulls last, reviewed_at desc`
        : sql`reviewed_at desc nulls last`
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 500)
  const [rows, [{ total }]] = await Promise.all([
    sql<Review[]>`
      select ${sql.unsafe(REVIEW_COLS)}
      from reviews where ${where} order by ${order} limit ${limit} offset ${f.offset ?? 0}`,
    sql<{ total: number }[]>`select count(*)::int as total from reviews where ${where}`,
  ])
  return { rows, total }
}

export async function getReview(appId: string, reviewId: string) {
  const sql = db()
  const [row] = await sql<Review[]>`
    select ${sql.unsafe(REVIEW_COLS)} from reviews where app_id = ${appId} and review_id = ${reviewId}`
  return row ?? null
}

/** How many analysed reviews carry each willingness-to-pay signal (none excluded). */
export async function signalCounts(appId: string) {
  return db()<{ signal: string; count: number }[]>`
    select wtp_signal as signal, count(*)::int as count from reviews
    where app_id = ${appId} and wtp_signal is not null and wtp_signal <> 'none' group by 1 order by count desc`
}

export async function topicCounts(appId: string) {
  return db()<{ topic: string; count: number }[]>`
    select topic, count(*)::int as count from reviews where app_id = ${appId} and topic is not null group by topic order by count desc`
}

export async function ratingBreakdown(appId: string) {
  return db()<{ rating: number; count: number }[]>`
    select rating, count(*)::int as count from reviews where app_id = ${appId} and rating is not null group by rating order by rating desc`
}

export interface Insights {
  app_id: string
  generated_at: Date
  model: string | null
  reviews_count: number
  sentiment: { positive: number; neutral: number; negative: number }
  complaints: { label: string; count: number }[]
  requests: { label: string; count: number }[]
  summary: string | null
}

export async function getInsights(appId: string) {
  const [row] = await db()<Insights[]>`select * from insights where app_id = ${appId}`
  return row ?? null
}

/** Reviews the next analysis run would send: never analysed, or analysed by an older classifier. */
export async function unanalysedCount(appId: string) {
  const [r] = await db()<{ n: number }[]>`
    select count(*)::int as n from reviews where app_id = ${appId} and (analysed_at is null or analysis_version < ${ANALYSIS_VERSION})`
  return r.n
}

export interface Change {
  id: string
  app_id: string
  app_name: string
  app_icon: string | null
  app_store: Store
  detected_at: Date
  field: string
  old_value: unknown
  new_value: unknown
  summary: string | null
}

export async function getChanges(f: { appId?: string; limit?: number; days?: number } = {}) {
  const sql = db()
  return sql<Change[]>`
    select c.id::text, c.app_id, a.name as app_name, a.icon_path as app_icon, a.store as app_store,
      c.detected_at, c.field, c.old_value, c.new_value, c.summary
    from changes c join apps a on a.id = c.app_id
    where (${f.appId ?? null}::uuid is null or c.app_id = ${f.appId ?? null})
      and (${f.days ?? null}::int is null or c.detected_at > now() - make_interval(days => ${f.days ?? 0}))
    order by c.detected_at desc limit ${f.limit ?? 100}`
}

export async function ratingHistory(appId: string, days = 90) {
  return db()<{ day: string; rating: number | null; ratings_count: number | null }[]>`
    select to_char(day, 'YYYY-MM-DD') as day, rating::float8 as rating, ratings_count::float8 as ratings_count
    from rating_history where app_id = ${appId} and day > current_date - ${days}::int order by day`
}

export async function dashboardStats() {
  const sql = db()
  const [s] = await sql<
    {
      apps: number
      ios: number
      android: number
      reviews_24h: number
      reviews_prev_7d_avg: number
      changes_7d: number
      positive: number
      neutral: number
      negative: number
      errors: number
      opportunities: number
      signals: number
    }[]
  >`
    select
      (select count(*)::int from apps) as apps,
      (select count(*)::int from apps where store = 'ios') as ios,
      (select count(*)::int from apps where store = 'android') as android,
      (select count(*)::int from reviews where fetched_at > now() - interval '24 hours') as reviews_24h,
      (select (count(*) / 7.0)::float8 from reviews where fetched_at between now() - interval '8 days' and now() - interval '24 hours') as reviews_prev_7d_avg,
      (select count(*)::int from changes where detected_at > now() - interval '7 days') as changes_7d,
      coalesce((select sum((sentiment->>'positive')::int)::int from insights), 0) as positive,
      coalesce((select sum((sentiment->>'neutral')::int)::int from insights), 0) as neutral,
      coalesce((select sum((sentiment->>'negative')::int)::int from insights), 0) as negative,
      (select count(*)::int from apps where status = 'error') as errors,
      (select count(*)::int from opportunities where status = 'surfaced') as opportunities,
      ((select count(*) from reviews where wtp_signal <> 'none' and coalesce(reviewed_at, fetched_at) > now() - interval '30 days')
        + (select count(*) from items where wtp_signal <> 'none' and coalesce(posted_at, fetched_at) > now() - interval '30 days'))::int as signals`
  const perDay = await sql<{ day: string; count: number }[]>`
    select to_char(d, 'YYYY-MM-DD') as day, coalesce(count(r.*), 0)::int as count
    from generate_series(current_date - 29, current_date, interval '1 day') d
    left join reviews r on r.reviewed_at >= d and r.reviewed_at < d + interval '1 day'
    group by d order by d`
  return { ...s, perDay }
}

export async function compareApps(ids: string[]) {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  if (!valid.length) return []
  const sql = db()
  const rows = await sql<(AppDetail & { insights: Insights | null })[]>`
    select ${appCols(sql)}, a.size_bytes::float8 as size_bytes, a.content_rating, a.updated_at_store,
      (select count(*)::int from reviews r where r.app_id = a.id) as reviews_count,
      (select count(*)::int from screenshots s where s.app_id = a.id and s.active) as screenshots_count,
      (select to_jsonb(i) from insights i where i.app_id = a.id) as insights
    from apps a where a.id = any(${valid}::uuid[])`
  return valid.map((id) => rows.find((r) => r.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
}

/** Everything the app shell (sidebar, command menu) needs, in one round trip. */
export async function navSummary() {
  const [row] = await db()<
    { apps: { id: string; name: string; store: Store; icon: string | null }[] | null; boards: number; opportunities: number }[]
  >`
    select
      (select json_agg(json_build_object('id', id, 'name', coalesce(nullif(name, ''), store_id), 'store', store, 'icon', icon_path) order by created_at desc) from apps) as apps,
      (select count(*)::int from boards) as boards,
      (select count(*)::int from opportunities where status <> 'killed') as opportunities`
  return { apps: row.apps ?? [], boards: row.boards, opportunities: row.opportunities }
}
