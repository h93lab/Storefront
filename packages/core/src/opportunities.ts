import { AiError, chat, embed, embeddingConfigured, parseJsonReply } from "./ai"
import { ANALYSIS_VERSION, applyClassifications, classifyBatch, pendingItems, submitClassificationBatch, WTP_SIGNALS } from "./analysis"
import { db, type Sql } from "./db"
import { enqueue } from "./jobs"
import { aiConfigured, DEFAULT_SETTINGS, getSettings, type Settings } from "./settings"
import { mapLimit } from "./sync"

export const OPPORTUNITY_STATUSES = ["surfaced", "validating", "building", "shipped", "killed"] as const
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number]
export type OpportunityKind = "complaint" | "request"
export const GATE_KEYS = [
  "scope",
  "permissions",
  "single_player",
  "monetization",
  "demand",
  "distribution",
  "data_legal",
  "founder_fit",
] as const

const isKind = (k: unknown): k is OpportunityKind => k === "complaint" || k === "request"
const isStatus = (s: unknown): s is OpportunityStatus => (OPPORTUNITY_STATUSES as readonly unknown[]).includes(s)
const normLabel = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
const oppId = (id: number | string) => {
  const n = Number(id)
  if (!Number.isInteger(n) || n < 1) throw new Error("Invalid opportunity id")
  return n
}

/* ------------------------------------------------------------------ scoring */

export interface ScoreInput {
  /** Recency-weighted evidence count (half-life from `settings.score.halfLifeDays`, 90 by default). */
  recent: number
  /** Distinct (store, store_id) listings that carry evidence. */
  listings: number
  avgPain: number
  /** Share of evidence that carries a willingness-to-pay signal (0..1). */
  wtpShare: number
}

export type ScoreWeights = Settings["score"]

/** Falls back to the defaults for anything that is not a usable number. */
function weightsOf(w: Partial<ScoreWeights> = {}): ScoreWeights {
  const d = DEFAULT_SETTINGS.score
  const n = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback)
  return {
    listingWeight: Math.max(0, n(w.listingWeight, d.listingWeight)),
    painWeight: Math.max(0, n(w.painWeight, d.painWeight)),
    wtpWeight: Math.max(0, n(w.wtpWeight, d.wtpWeight)),
    halfLifeDays: Math.max(1, n(w.halfLifeDays, d.halfLifeDays)),
    autoMapThreshold: Math.min(1, Math.max(0, n(w.autoMapThreshold, d.autoMapThreshold))),
  }
}

/**
 * Mirrors the SQL in `statsSelect`; kept here so the formula is testable without a database.
 * `recent` is already recency-weighted, so the half-life is not needed here.
 */
export function opportunityScore({ recent, listings, avgPain, wtpShare }: ScoreInput, weights: Partial<ScoreWeights> = {}) {
  const w = weightsOf(weights)
  return recent * (1 + w.listingWeight * (Math.max(listings, 1) - 1)) * (1 + (w.painWeight * avgPain) / 5) * (1 + w.wtpWeight * wtpShare)
}

/* ----------------------------------------------------------------- grouping */

export interface UnmappedLabel {
  label: string
  count: number
  kind: OpportunityKind
}
export interface GroupingResult {
  /** label -> existing opportunity id */
  map: Map<string, number>
  /** new opportunities with their member labels */
  groups: { label: string; kind: OpportunityKind; labels: string[] }[]
}

/**
 * Validates a model reply against the batch it answered. Unknown ids and labels
 * outside the batch are dropped, every label is used at most once (first
 * mention wins), and labels the model forgot become opportunities of their own.
 * A reply that is not an object is treated as empty.
 */
export function validateGrouping(reply: unknown, batch: UnmappedLabel[], existingIds: Set<number>): GroupingResult {
  const byLabel = new Map(batch.map((b) => [normLabel(b.label), b]))
  const taken = new Set<string>()
  const map = new Map<string, number>()
  const groups: GroupingResult["groups"] = []
  const r = (reply && typeof reply === "object" ? reply : {}) as { map?: unknown; new?: unknown }

  for (const m of Array.isArray(r.map) ? r.map : []) {
    const label = normLabel(m?.label)
    const id = Number(m?.opportunity_id)
    if (!byLabel.has(label) || taken.has(label) || !existingIds.has(id)) continue
    taken.add(label)
    map.set(label, id)
  }
  for (const g of Array.isArray(r.new) ? r.new : []) {
    const members: string[] = []
    for (const l of Array.isArray(g?.labels) ? g.labels : []) {
      const label = normLabel(l)
      if (!byLabel.has(label) || taken.has(label)) continue
      taken.add(label)
      members.push(label)
    }
    if (!members.length) continue
    const canonical =
      String(g?.label ?? "")
        .trim()
        .slice(0, 60) || members[0].slice(0, 60)
    groups.push({ label: canonical, kind: isKind(g?.kind) ? g.kind : majorityKind(members.map((m) => byLabel.get(m)!)), labels: members })
  }
  for (const b of batch) {
    const label = normLabel(b.label)
    if (taken.has(label)) continue
    taken.add(label)
    groups.push({ label: label.slice(0, 60), kind: b.kind, labels: [label] })
  }
  return { map, groups }
}

function majorityKind(xs: UnmappedLabel[]): OpportunityKind {
  const w = { complaint: 0, request: 0 }
  for (const x of xs) w[x.kind] += x.count
  return w.request > w.complaint ? "request" : "complaint"
}

const GROUP_SYSTEM = `You group app-review labels into product opportunities. An opportunity is one recurring missing capability.
Input JSON: {"existing":[{"id":1,"label":"..."}],"labels":[{"label":"...","count":0,"kind":"complaint|request"}]}.
Return JSON only: {"map":[{"label":"...","opportunity_id":123}],"new":[{"label":"canonical label","kind":"complaint|request","labels":["...","..."]}]}
Rules:
- Map a label to an existing opportunity only when the underlying missing capability is the same.
- A new opportunity's canonical label is the clearest of its member labels, at most 60 characters, in the form "<missing capability> — <context>", with no app names.
- Every input label must appear exactly once, either in "map" or in the "labels" of one "new" group. Copy labels exactly as given.
- Killed opportunities are part of the existing list on purpose: duplicates of killed ideas must map to them.`

const GROUP_BATCH = 120

/** Distinct lowercased complaint/request labels (reviews and items) that no opportunity owns yet. */
const unmappedRel = (sql: Sql) => sql`
  select l.label, sum(l.n)::int as count, (array_agg(l.kind order by l.n desc))[1] as kind
  from (
    select lower(trim(label)) as label, label_kind as kind, count(*) as n from reviews
      where label is not null and trim(label) <> '' and label_kind in ('complaint', 'request') group by 1, 2
    union all
    select lower(trim(label)), label_kind, count(*) from items
      where label is not null and trim(label) <> '' and label_kind in ('complaint', 'request') group by 1, 2
  ) l
  where not exists (select 1 from opportunity_labels ol where ol.label = l.label)
  group by l.label`

const unmappedLabels = (sql: Sql) => sql<UnmappedLabel[]>`select * from (${unmappedRel(sql)}) u order by count desc, label`

/* --------------------------------------------------------------- embeddings */

/** pgvector is optional: the migration only creates `label_embeddings` when the extension is available. */
const vectorsAvailable = async (sql: Sql) => {
  const [r] = await sql<{ ok: boolean }[]>`select to_regclass('label_embeddings') is not null as ok`
  return r.ok
}

/** The column is `vector(1024)`; a provider must be asked for 1024 dimensions. */
const VECTOR_DIMENSIONS = 1024
const vectorText = (v: number[]) => {
  if (v.length !== VECTOR_DIMENSIONS) {
    throw new AiError(
      `The embedding model returned ${v.length} dimensions but the database stores ${VECTOR_DIMENSIONS}. Set dimensions to ${VECTOR_DIMENSIONS} in Settings.`,
    )
  }
  return `[${v.join(",")}]`
}

/**
 * Embeds every label of `opportunity_labels` and every not-yet-mapped label that
 * has no vector from the current embedding model. Does nothing (returns 0) when
 * embeddings are not configured or pgvector is not installed.
 */
export async function embedLabels(opts: { log?: (m: string) => void; signal?: AbortSignal } = {}): Promise<{ embedded: number }> {
  const settings = await getSettings()
  const sql = db()
  if (!embeddingConfigured(settings) || !(await vectorsAvailable(sql))) return { embedded: 0 }
  const cfg = settings.ai.embedding
  const missing = await sql<{ label: string }[]>`
    select label from (
      select label from opportunity_labels
      union
      select label from (${unmappedRel(sql)}) u
    ) l
    where not exists (select 1 from label_embeddings e where e.label = l.label and e.model = ${cfg.model})
    order by label`
  let embedded = 0
  for (let i = 0; i < missing.length; i += 200) {
    opts.signal?.throwIfAborted()
    const labels = missing.slice(i, i + 200).map((m) => m.label)
    const vectors = (await embed(cfg, labels, { inputType: "document" })).map(vectorText)
    await sql`
      insert into label_embeddings (label, model, v)
      select t.label, ${cfg.model}, t.v::vector from unnest(${labels}::text[], ${vectors}::text[]) as t(label, v)
      on conflict (label) do update set model = excluded.model, v = excluded.v, created_at = now()`
    embedded += labels.length
    opts.log?.(`embedded ${embedded}/${missing.length} labels`)
  }
  return { embedded }
}

/**
 * Sets `opportunities.centroid` to the mean vector of the opportunity's labels
 * (all opportunities, or just `ids`). Returns how many centroids were written.
 */
export async function recomputeCentroids(ids?: number[]): Promise<number> {
  const settings = await getSettings()
  const sql = db()
  if (!embeddingConfigured(settings) || !(await vectorsAvailable(sql))) return 0
  const scope = ids ? [...new Set(ids.map(oppId))] : null
  const rows = await sql`
    update opportunities o set centroid = c.v
    from (
      select ol.opportunity_id as id, avg(e.v) as v
      from opportunity_labels ol join label_embeddings e on e.label = ol.label and e.model = ${settings.ai.embedding.model}
      where (${scope}::bigint[] is null or ol.opportunity_id = any(${scope}::bigint[]))
      group by ol.opportunity_id
    ) c
    where o.id = c.id returning o.id`
  return rows.length
}

export interface SimilarOpportunity {
  id: number
  label: string
  status: OpportunityStatus
  /** Cosine similarity of the centroids, 0..1 for typical embeddings. */
  similarity: number
}

/** Other opportunities closest to this one by centroid (killed ones included, so "previously killed" shows up). Empty when embeddings are off. */
export async function similarOpportunities(id: number | string, limit = 5): Promise<SimilarOpportunity[]> {
  const n = oppId(id)
  const sql = db()
  if (!embeddingConfigured(await getSettings()) || !(await vectorsAvailable(sql))) return []
  return sql<SimilarOpportunity[]>`
    select o.id::int as id, o.label, o.status, (1 - (o.centroid <=> me.centroid))::float8 as similarity
    from opportunities o, (select centroid from opportunities where id = ${n}) me
    where o.id <> ${n} and o.centroid is not null and me.centroid is not null
    order by o.centroid <=> me.centroid, o.id limit ${Math.min(50, Math.max(1, Math.round(limit)))}`
}

/**
 * Maps labels whose vector is at least `threshold` similar to an opportunity
 * centroid (killed opportunities included) onto that opportunity. Returns the
 * labels handled and the opportunities touched.
 */
async function autoMapLabels(sql: Sql, labels: string[], model: string, threshold: number) {
  if (!labels.length) return { mapped: new Set<string>(), touched: [] as number[] }
  const hits = await sql<{ label: string; id: number }[]>`
    select e.label, n.id
    from label_embeddings e
    cross join lateral (
      select o.id::int as id, (1 - (e.v <=> o.centroid))::float8 as sim
      from opportunities o where o.centroid is not null order by e.v <=> o.centroid limit 1
    ) n
    where e.label = any(${labels}::text[]) and e.model = ${model} and n.sim >= ${threshold}`
  if (!hits.length) return { mapped: new Set<string>(), touched: [] as number[] }
  await sql`
    insert into opportunity_labels (label, opportunity_id)
    select * from unnest(${hits.map((h) => h.label)}::text[], ${hits.map((h) => h.id)}::bigint[])
    on conflict (label) do nothing`
  const touched = [...new Set(hits.map((h) => h.id))]
  await sql`update opportunities set updated_at = now() where id = any(${touched}::bigint[])`
  return { mapped: new Set(hits.map((h) => h.label)), touched }
}

/**
 * Assigns every not-yet-mapped review/item label to an opportunity. With
 * embeddings configured, labels close to an existing opportunity's centroid
 * (killed ones included) are mapped without the model; the rest go to the model,
 * which matches existing opportunities or forms new ones.
 */
export async function groupLabels(
  opts: { batchSize?: number; log?: (m: string) => void; onProgress?: (m: string) => void; signal?: AbortSignal } = {},
): Promise<{ mapped: number; created: number }> {
  const sql = db()
  const log = opts.log ?? (() => {})
  let unmapped: UnmappedLabel[] = await unmappedLabels(sql)
  if (!unmapped.length) return { mapped: 0, created: 0 }

  const settings = await getSettings()
  let mapped = 0
  let created = 0
  const touched = new Set<number>()

  const useVectors = embeddingConfigured(settings) && (await vectorsAvailable(sql))
  if (useVectors) {
    try {
      await embedLabels({ log, signal: opts.signal })
      const auto = await autoMapLabels(
        sql,
        unmapped.map((u) => u.label),
        settings.ai.embedding.model,
        weightsOf(settings.score).autoMapThreshold,
      )
      if (auto.mapped.size) {
        unmapped = unmapped.filter((u) => !auto.mapped.has(u.label))
        mapped += auto.mapped.size
        auto.touched.forEach((id) => touched.add(id))
        log(`auto-mapped ${auto.mapped.size} labels by embedding similarity`)
      }
    } catch (e) {
      opts.signal?.throwIfAborted()
      log(`embedding auto-map skipped: ${(e as Error).message}`)
    }
  }

  if (unmapped.length && !aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")

  const size = opts.batchSize ?? GROUP_BATCH
  let done = 0
  for (let i = 0; i < unmapped.length; i += size) {
    opts.signal?.throwIfAborted()
    const batch = unmapped.slice(i, i + size)
    // Reloaded per batch so later batches can join opportunities created by earlier ones.
    const existing = await sql<{ id: number; label: string }[]>`select id::int, label from opportunities order by id`
    const text = await chat(
      settings.ai,
      [
        { role: "system", content: GROUP_SYSTEM },
        { role: "user", content: JSON.stringify({ existing, labels: batch }) },
      ],
      { json: true, maxTokens: 8000 },
    )
    let reply: unknown = null
    try {
      reply = parseJsonReply(text)
    } catch (e) {
      log(`grouping reply was not valid JSON, one opportunity per label: ${(e as Error).message}`)
    }
    const { map, groups } = validateGrouping(reply, batch, new Set(existing.map((e) => e.id)))

    if (groups.length) {
      const ids = await sql<{ id: number }[]>`
        insert into opportunities (label, kind)
        select * from unnest(${groups.map((g) => g.label)}::text[], ${groups.map((g) => g.kind)}::text[])
        returning id::int`
      const rows = groups.flatMap((g, gi) => g.labels.map((label) => ({ label, opportunity_id: ids[gi].id })))
      await sql`
        insert into opportunity_labels (label, opportunity_id)
        select * from unnest(${rows.map((r) => r.label)}::text[], ${rows.map((r) => r.opportunity_id)}::bigint[])
        on conflict (label) do nothing`
      created += groups.length
      ids.forEach((r) => touched.add(r.id))
    }
    if (map.size) {
      const entries = [...map]
      await sql`
        insert into opportunity_labels (label, opportunity_id)
        select * from unnest(${entries.map(([l]) => l)}::text[], ${entries.map(([, id]) => id)}::bigint[])
        on conflict (label) do nothing`
      await sql`update opportunities set updated_at = now() where id = any(${[...new Set(map.values())]}::bigint[])`
      mapped += map.size
      for (const id of map.values()) touched.add(id)
    }
    done += batch.length
    log(`grouped ${done}/${unmapped.length} labels`)
    opts.onProgress?.(`Grouping labels ${done}/${unmapped.length}`)
  }

  if (useVectors && touched.size) {
    try {
      await recomputeCentroids([...touched])
    } catch (e) {
      log(`centroid update skipped: ${(e as Error).message}`)
    }
  }
  return { mapped, created }
}

/* ----------------------------------------------------------------- evidence */

export interface Evidence {
  source: "review" | "item"
  ref: string
  opportunity_id: number | null
  label: string | null
  label_kind: string | null
  app_id: string | null
  app_name: string | null
  app_icon: string | null
  store: "ios" | "android" | null
  country: string | null
  rating: number | null
  title: string | null
  body: string | null
  evidence_span: string | null
  wtp_signal: string | null
  competitor_mentioned: string | null
  workaround: string | null
  pain_score: number | null
  date: Date | null
  url: string | null
}

/** Reviews (joined to their app) and imported items as one relation. Nullable opportunity: unmapped evidence is included. */
const evidenceRel = (sql: Sql) => sql`
  select 'review'::text as source, r.app_id::text || ':' || r.review_id as ref, ol.opportunity_id as opp_id, r.label, r.label_kind,
    r.app_id, a.store, a.store_id, coalesce(nullif(a.name, ''), a.store_id) as app_name, a.icon_path as app_icon, a.country,
    a.own as own, r.rating::int as rating, r.title, r.body, r.evidence_span, r.wtp_signal, r.competitor_mentioned, r.workaround,
    r.pain_score::int as pain, r.reviewed_at as dt, a.store_url as url, r.analysis_version::int as av
  from reviews r join apps a on a.id = r.app_id
  left join opportunity_labels ol on ol.label = lower(trim(r.label))
  union all
  select 'item', i.id::text, ol.opportunity_id, i.label, i.label_kind,
    i.app_id, a.store, a.store_id, coalesce(nullif(a.name, ''), a.store_id), a.icon_path, a.country,
    coalesce(a.own, false), null::int, null::text, i.body, i.evidence_span, i.wtp_signal, i.competitor_mentioned, i.workaround,
    i.pain_score::int, i.posted_at, i.url, i.analysis_version::int
  from items i left join apps a on a.id = i.app_id
  left join opportunity_labels ol on ol.label = lower(trim(i.label))`

export type OwnFilter = "exclude" | "only" | "all"
const ownCond = (sql: Sql, own: OwnFilter = "exclude") => (own === "only" ? sql`own` : own === "all" ? sql`true` : sql`not own`)

const EVIDENCE_COLS = `source, ref, opp_id as opportunity_id, label, label_kind, app_id::text as app_id, app_name, app_icon, store, country, rating, title,
  body, evidence_span, wtp_signal, competitor_mentioned, workaround, pain as pain_score, dt as date, url`

export interface OpportunityStats {
  id: number
  label: string
  kind: OpportunityKind
  status: OpportunityStatus
  notes: string | null
  gate: { checks: Record<string, boolean>; notes?: string; checked_at?: string } | null
  has_spec: boolean
  spec_generated_at: Date | null
  outcome: { installs: number; trial_starts: number; paying: number; notes: string; recorded_at: string } | null
  killed_reason: string | null
  revisit_after: Date | null
  validation_metrics: ValidationMetrics | null
  created_at: Date
  updated_at: Date
  n: number
  listings: number
  apps: number
  avg_pain: number
  neg_share: number
  signals: { paying_competitor: number; churned: number; workaround: number; stated_wtp: number }
  recent: number
  last_seen: Date | null
  competitors: { name: string; count: number }[]
  score: number
}

export interface OpportunityQuery {
  /** Default 'active' = everything except killed. */
  status?: OpportunityStatus | "active" | "all"
  kind?: OpportunityKind
  own?: OwnFilter
  q?: string
  sort?: "score" | "recent" | "n" | "listings" | "last_seen" | "updated"
}

const SORTS = {
  score: "score desc",
  recent: "recent desc",
  n: "n desc",
  listings: "listings desc",
  last_seen: "last_seen desc nulls last",
  updated: "updated_at desc",
} as const

/** One statement: evidence union grouped by opportunity, with the score computed in SQL (see `opportunityScore`). */
function statsSelect(sql: Sql, o: OpportunityQuery & { id?: number; requireEvidence: boolean }, weights: ScoreWeights) {
  const status = o.status ?? "active"
  const conds = [
    o.id !== undefined ? sql`o.id = ${o.id}` : sql`true`,
    status === "all" ? sql`true` : status === "active" ? sql`o.status <> 'killed'` : sql`o.status = ${status}`,
    o.kind ? sql`o.kind = ${o.kind}` : sql`true`,
    o.q?.trim() ? sql`(o.label ilike ${"%" + o.q.trim() + "%"} or o.notes ilike ${"%" + o.q.trim() + "%"})` : sql`true`,
    o.requireEvidence ? sql`s.opp_id is not null` : sql`true`,
  ]
  const where = conds.reduce((a, b) => sql`${a} and ${b}`)
  const order = sql.unsafe(SORTS[o.sort ?? "score"] ?? SORTS.score)
  return sql<OpportunityStats[]>`
    with ev as (${evidenceRel(sql)}),
    scoped as (
      select * from ev where opp_id is not null and label_kind in ('complaint', 'request') and ${ownCond(sql, o.own)}
    ),
    comps as (
      select opp_id, competitor_mentioned as name, count(*) as c,
        row_number() over (partition by opp_id order by count(*) desc, competitor_mentioned) as rn
      from scoped where competitor_mentioned is not null group by 1, 2
    ),
    agg as (
      select opp_id,
        count(*)::int as n,
        count(distinct store || ':' || store_id)::int as listings,
        count(distinct app_id)::int as apps,
        coalesce(avg(pain), 0)::float8 as avg_pain,
        coalesce(avg(case when source = 'review' then (case when rating <= 2 then 1 else 0 end)
                          else (case when pain >= 3 then 1 else 0 end) end), 0)::float8 as neg_share,
        count(*) filter (where wtp_signal = 'paying_competitor')::int as paying_competitor,
        count(*) filter (where wtp_signal = 'churned')::int as churned,
        count(*) filter (where wtp_signal = 'workaround')::int as workaround,
        count(*) filter (where wtp_signal = 'stated_wtp')::int as stated_wtp,
        coalesce(sum(exp(-ln(2) / ${weights.halfLifeDays}::float8 * (extract(epoch from now() - coalesce(dt, now() - interval '180 days')) / 86400))), 0)::float8 as recent,
        max(dt) as last_seen
      from scoped group by opp_id
    ),
    s as (
      select agg.*,
        (paying_competitor + churned + workaround + stated_wtp)::float8 / nullif(n, 0) as wtp_share,
        (select coalesce(json_agg(json_build_object('name', c.name, 'count', c.c::int) order by c.rn), '[]'::json)
           from comps c where c.opp_id = agg.opp_id and c.rn <= 5) as competitors
      from agg
    )
    select o.id::int as id, o.label, o.kind, o.status, o.notes, o.gate, (o.spec_md is not null) as has_spec, o.spec_generated_at,
      o.outcome, o.killed_reason, o.revisit_after, o.validation_metrics, o.created_at, o.updated_at,
      coalesce(s.n, 0)::int as n, coalesce(s.listings, 0)::int as listings, coalesce(s.apps, 0)::int as apps,
      coalesce(s.avg_pain, 0)::float8 as avg_pain, coalesce(s.neg_share, 0)::float8 as neg_share,
      json_build_object('paying_competitor', coalesce(s.paying_competitor, 0), 'churned', coalesce(s.churned, 0),
        'workaround', coalesce(s.workaround, 0), 'stated_wtp', coalesce(s.stated_wtp, 0)) as signals,
      coalesce(s.recent, 0)::float8 as recent, s.last_seen, coalesce(s.competitors, '[]'::json) as competitors,
      (coalesce(s.recent, 0) * (1 + ${weights.listingWeight}::float8 * (greatest(coalesce(s.listings, 0), 1) - 1))
        * (1 + ${weights.painWeight}::float8 * coalesce(s.avg_pain, 0) / 5.0)
        * (1 + ${weights.wtpWeight}::float8 * coalesce(s.wtp_share, 0)))::float8 as score
    from opportunities o left join s on s.opp_id = o.id
    where ${where}
    order by ${order}, o.id`
}

/** Opportunities with their evidence statistics and score. Opportunities without evidence in the chosen view are omitted. */
export async function listOpportunities(opts: OpportunityQuery = {}) {
  const { score } = await getSettings()
  return statsSelect(db(), { ...opts, requireEvidence: true }, weightsOf(score))
}
/** Alias of `listOpportunities`. */
export const opportunityStats = listOpportunities

export async function getOpportunity(id: number | string) {
  const sql = db()
  const n = oppId(id)
  const { score } = await getSettings()
  const [[stats], evidence, labels, specRows] = await Promise.all([
    statsSelect(sql, { id: n, status: "all", own: "all", requireEvidence: false }, weightsOf(score)),
    sql<Evidence[]>`
      with ev as (${evidenceRel(sql)})
      select ${sql.unsafe(EVIDENCE_COLS)} from ev where opp_id = ${n}
      order by dt desc nulls last, ref limit 200`,
    sql<{ label: string; count: number }[]>`
      select ol.label,
        ((select count(*) from reviews r where lower(trim(r.label)) = ol.label)
          + (select count(*) from items i where lower(trim(i.label)) = ol.label))::int as count
      from opportunity_labels ol where ol.opportunity_id = ${n} order by count desc, ol.label`,
    sql<{ spec_md: string | null; validation: ValidationKit | null; validation_metrics: ValidationMetrics | null }[]>`
      select spec_md, validation, validation_metrics from opportunities where id = ${n}`,
  ])
  if (!stats) return null
  const validation_metrics = specRows[0]?.validation_metrics ?? null
  return {
    ...stats,
    spec_md: specRows[0]?.spec_md ?? null,
    validation: specRows[0]?.validation ?? null,
    validation_metrics,
    validation_decision: validationDecision(validation_metrics),
    evidence,
    labels,
  }
}

export interface EvidenceQuery {
  q?: string
  /** 'any' = any signal except none. */
  signal?: string
  label?: string
  minPain?: number
  own?: OwnFilter
  limit?: number
  offset?: number
}

/** Cross-app evidence search over reviews and imported items. */
export async function searchEvidence(f: EvidenceQuery = {}) {
  const sql = db()
  const conds = [ownCond(sql, f.own)]
  if (f.q?.trim()) {
    const like = "%" + f.q.trim() + "%"
    conds.push(sql`(body ilike ${like} or title ilike ${like} or evidence_span ilike ${like})`)
  }
  if (f.signal === "any") conds.push(sql`wtp_signal is not null and wtp_signal <> 'none'`)
  else if (f.signal) conds.push(sql`wtp_signal = ${f.signal}`)
  if (f.label?.trim()) conds.push(sql`lower(label) like ${"%" + f.label.trim().toLowerCase() + "%"}`)
  if (f.minPain !== undefined) conds.push(sql`pain >= ${f.minPain}`)
  const where = conds.reduce((a, b) => sql`${a} and ${b}`)
  const limit = Math.min(200, Math.max(1, f.limit ?? 50))
  const [rows, [{ total }]] = await Promise.all([
    sql<Evidence[]>`
      with ev as (${evidenceRel(sql)})
      select ${sql.unsafe(EVIDENCE_COLS)} from ev where ${where}
      order by dt desc nulls last, ref limit ${limit} offset ${f.offset ?? 0}`,
    sql<{ total: number }[]>`with ev as (${evidenceRel(sql)}) select count(*)::int as total from ev where ${where}`,
  ])
  return { rows, total }
}

/* ---------------------------------------------------------------- mutations */

export async function setOpportunityStatus(
  id: number | string,
  status: OpportunityStatus,
  opts: { reason?: string | null; revisitAfter?: Date | string | null } = {},
) {
  if (!isStatus(status)) throw new Error(`Invalid status "${status}"`)
  const n = oppId(id)
  const revisit = opts.revisitAfter ? new Date(opts.revisitAfter) : null
  if (revisit && Number.isNaN(revisit.getTime())) throw new Error("Invalid revisit date")
  const killed = status === "killed"
  const rows = await db()`
    update opportunities set status = ${status}, killed_reason = ${killed ? opts.reason?.trim() || null : null},
      revisit_after = ${killed ? revisit : null}, updated_at = now() where id = ${n} returning id`
  if (!rows.length) throw new Error("Opportunity not found")
}

export async function saveGate(id: number | string, gate: { checks: Record<string, boolean>; notes?: string | null }) {
  const checks: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(gate.checks)) {
    if (!(GATE_KEYS as readonly string[]).includes(k)) throw new Error(`Unknown gate check "${k}"`)
    checks[k] = Boolean(v)
  }
  const value = { checks, notes: gate.notes?.trim() ?? "", checked_at: new Date().toISOString() }
  const sql = db()
  const rows = await sql`update opportunities set gate = ${sql.json(value)}, updated_at = now() where id = ${oppId(id)} returning id`
  if (!rows.length) throw new Error("Opportunity not found")
  return value
}

export async function saveSpec(id: number | string, md: string) {
  const rows = await db()`
    update opportunities set spec_md = ${md}, spec_generated_at = now(), updated_at = now() where id = ${oppId(id)} returning id`
  if (!rows.length) throw new Error("Opportunity not found")
}

export async function recordOutcome(
  id: number | string,
  outcome: { installs?: number; trial_starts?: number; paying?: number; notes?: string | null },
) {
  const count = (v: unknown) => Math.max(0, Math.round(Number(v) || 0))
  const value = {
    installs: count(outcome.installs),
    trial_starts: count(outcome.trial_starts),
    paying: count(outcome.paying),
    notes: outcome.notes?.trim() ?? "",
    recorded_at: new Date().toISOString(),
  }
  const sql = db()
  const rows = await sql`update opportunities set outcome = ${sql.json(value)}, updated_at = now() where id = ${oppId(id)} returning id`
  if (!rows.length) throw new Error("Opportunity not found")
  return value
}

export async function updateOpportunity(id: number | string, patch: { label?: string; notes?: string | null; kind?: OpportunityKind }) {
  const label = patch.label !== undefined ? patch.label.trim().slice(0, 120) : undefined
  if (label === "") throw new Error("Label cannot be empty")
  if (patch.kind !== undefined && !isKind(patch.kind)) throw new Error("Kind must be complaint or request")
  const rows = await db()`
    update opportunities set
      label = coalesce(${label ?? null}, label),
      kind = coalesce(${patch.kind ?? null}, kind),
      notes = case when ${patch.notes !== undefined} then ${patch.notes?.trim() || null} else notes end,
      updated_at = now()
    where id = ${oppId(id)} returning id`
  if (!rows.length) throw new Error("Opportunity not found")
}

/** Moves every label of `fromId` onto `intoId` and deletes `fromId`. */
export async function mergeOpportunities(fromId: number | string, intoId: number | string) {
  const from = oppId(fromId)
  const into = oppId(intoId)
  if (from === into) throw new Error("Cannot merge an opportunity into itself")
  await db().begin(async (tx) => {
    const found = await tx`select id from opportunities where id in (${from}, ${into}) for update`
    if (found.length !== 2) throw new Error("Opportunity not found")
    await tx`update opportunity_labels set opportunity_id = ${into} where opportunity_id = ${from}`
    await tx`delete from opportunities where id = ${from}`
    await tx`update opportunities set updated_at = now() where id = ${into}`
  })
  // The merged opportunity's centroid must cover the labels it just received (best effort; embeddings are optional).
  await recomputeCentroids([into]).catch(() => 0)
}

/* ----------------------------------------------------------------- verdicts */

export type VerdictSource = "review" | "item"
export interface VerdictCorrection {
  wtp_signal?: WtpSignalValue
  label_kind?: "complaint" | "request" | "praise" | "other"
  pain_score?: number
  label?: string
}
type WtpSignalValue = (typeof WTP_SIGNALS)[number]
export interface Verdict {
  id: number
  source: VerdictSource
  ref: string
  verdict: "correct" | "wrong"
  corrected: VerdictCorrection | null
  notes: string | null
  analysis_version: number
  created_at: Date
}

const LABEL_KINDS = ["complaint", "request", "praise", "other"] as const

/** Keeps only well-formed correction fields; throws on values outside the fixed vocabularies. */
function cleanCorrection(c: unknown): VerdictCorrection | null {
  if (!c || typeof c !== "object") return null
  const r = c as Record<string, unknown>
  const out: VerdictCorrection = {}
  if (r.wtp_signal !== undefined && r.wtp_signal !== null) {
    if (!(WTP_SIGNALS as readonly unknown[]).includes(r.wtp_signal)) throw new Error(`Invalid wtp_signal "${String(r.wtp_signal)}"`)
    out.wtp_signal = r.wtp_signal as WtpSignalValue
  }
  if (r.label_kind !== undefined && r.label_kind !== null) {
    if (!(LABEL_KINDS as readonly unknown[]).includes(r.label_kind)) throw new Error(`Invalid label_kind "${String(r.label_kind)}"`)
    out.label_kind = r.label_kind as VerdictCorrection["label_kind"]
  }
  if (r.pain_score !== undefined && r.pain_score !== null) {
    const p = Number(r.pain_score)
    if (!Number.isFinite(p) || p < 0 || p > 5) throw new Error("pain_score must be between 0 and 5")
    out.pain_score = Math.round(p)
  }
  if (typeof r.label === "string" && r.label.trim()) out.label = r.label.trim().replace(/\.$/, "").slice(0, 80)
  return Object.keys(out).length ? out : null
}

/** Splits an Evidence ref; review refs are `<app_id>:<review_id>`, item refs a bare id. */
function parseRef(source: VerdictSource, ref: string) {
  if (source === "item") {
    if (!/^\d+$/.test(ref)) throw new Error("Invalid item ref")
    return { itemId: ref }
  }
  const i = ref.indexOf(":")
  const appId = ref.slice(0, i)
  if (i < 0 || !/^[0-9a-f-]{36}$/i.test(appId) || i === ref.length - 1) throw new Error("Invalid review ref")
  return { appId, reviewId: ref.slice(i + 1) }
}

/**
 * Saves the human verdict on one classified review/item (one per row; recording again replaces it).
 * Any `corrected` fields are also written onto the row so the fix shows up everywhere.
 */
export async function recordVerdict(v: {
  source: VerdictSource
  ref: string
  verdict: "correct" | "wrong"
  corrected?: VerdictCorrection | null
  notes?: string | null
}): Promise<Verdict> {
  if (v.source !== "review" && v.source !== "item") throw new Error("source must be review or item")
  if (v.verdict !== "correct" && v.verdict !== "wrong") throw new Error("verdict must be correct or wrong")
  const corrected = cleanCorrection(v.corrected)
  const p = parseRef(v.source, v.ref)
  const sql = db()
  return sql.begin(async (tx) => {
    const [row] =
      v.source === "review"
        ? await tx<{ analysis_version: number }[]>`
            select analysis_version::int from reviews where app_id = ${p.appId!}::uuid and review_id = ${p.reviewId!} for update`
        : await tx<{ analysis_version: number }[]>`
            select analysis_version::int from items where id = ${p.itemId!}::bigint for update`
    if (!row) throw new Error("Evidence not found")
    if (corrected) {
      const set = tx`
        wtp_signal = coalesce(${corrected.wtp_signal ?? null}, wtp_signal),
        label_kind = coalesce(${corrected.label_kind ?? null}, label_kind),
        pain_score = coalesce(${corrected.pain_score ?? null}::smallint, pain_score),
        label = coalesce(${corrected.label ?? null}, label)`
      if (v.source === "review") {
        await tx`update reviews set ${set} where app_id = ${p.appId!}::uuid and review_id = ${p.reviewId!}`
      } else {
        await tx`update items set ${set} where id = ${p.itemId!}::bigint`
      }
    }
    const [saved] = await tx<Verdict[]>`
      insert into review_verdicts (source, ref, verdict, corrected, notes, analysis_version)
      values (${v.source}, ${v.ref}, ${v.verdict}, ${corrected ? tx.json(corrected as never) : null}, ${v.notes?.trim() || null}, ${row.analysis_version})
      on conflict (source, ref) do update set verdict = excluded.verdict, corrected = excluded.corrected, notes = excluded.notes,
        analysis_version = excluded.analysis_version, created_at = now()
      returning id::int, source, ref, verdict, corrected, notes, analysis_version::int, created_at`
    return saved
  })
}

/** Removes a verdict (the evidence row keeps any correction that was written through). Returns whether one existed. */
export async function deleteVerdict(source: VerdictSource, ref: string) {
  const rows = await db()`delete from review_verdicts where source = ${source} and ref = ${ref} returning id`
  return rows.length > 0
}

/** Evidence classified by the current analyser and not yet judged; rows with a willingness-to-pay signal come first, then random. */
export async function reviewQueue(opts: { limit?: number; onlySignals?: boolean } = {}) {
  const sql = db()
  const limit = Math.min(100, Math.max(1, Math.round(opts.limit ?? 20)))
  const signals = opts.onlySignals ? sql`and coalesce(wtp_signal, 'none') <> 'none'` : sql``
  return sql<Evidence[]>`
    with ev as (${evidenceRel(sql)})
    select ${sql.unsafe(EVIDENCE_COLS)} from ev
    where av = ${ANALYSIS_VERSION}
      and not exists (select 1 from review_verdicts v where v.source = ev.source and v.ref = ev.ref)
      ${signals}
    order by (coalesce(wtp_signal, 'none') <> 'none') desc, random() limit ${limit}`
}

export interface AccuracyStats {
  total: number
  correct: number
  wrong: number
  /** correct / total, 0 when there are no verdicts. */
  accuracy: number
  byVersion: { version: number; total: number; correct: number }[]
  bySignal: { signal: string; total: number; correct: number }[]
  byKind: { kind: string; total: number; correct: number }[]
}

/**
 * How often the classifier was judged right. Verdicts are joined to their evidence
 * row and bucketed by what the model originally said (`raw_analysis`), falling back
 * to the stored value, so a correction does not move a verdict into another bucket.
 */
export async function accuracyStats(): Promise<AccuracyStats> {
  const rows = await db()<{ version: number; signal: string; kind: string; total: number; correct: number }[]>`
    with ev as (
      select 'review'::text as source, r.app_id::text || ':' || r.review_id as ref, r.wtp_signal, r.label_kind, r.raw_analysis as raw from reviews r
      union all
      select 'item', i.id::text, i.wtp_signal, i.label_kind, i.raw_analysis from items i
    )
    select v.analysis_version::int as version,
      case when ev.raw->>'wtp_signal' = any(${[...WTP_SIGNALS]}::text[]) then ev.raw->>'wtp_signal' else coalesce(ev.wtp_signal, 'none') end as signal,
      case when ev.raw->>'kind' = any(${[...LABEL_KINDS]}::text[]) then ev.raw->>'kind' else coalesce(ev.label_kind, 'other') end as kind,
      count(*)::int as total, count(*) filter (where v.verdict = 'correct')::int as correct
    from review_verdicts v join ev on ev.source = v.source and ev.ref = v.ref
    group by 1, 2, 3`
  const roll = <K extends string>(key: "version" | "signal" | "kind", name: K) => {
    const m = new Map<string | number, { total: number; correct: number }>()
    for (const r of rows) {
      const cur = m.get(r[key]) ?? { total: 0, correct: 0 }
      cur.total += r.total
      cur.correct += r.correct
      m.set(r[key], cur)
    }
    return [...m].map(([k, v]) => ({ [name]: k, ...v }))
  }
  const total = rows.reduce((a, r) => a + r.total, 0)
  const correct = rows.reduce((a, r) => a + r.correct, 0)
  return {
    total,
    correct,
    wrong: total - correct,
    accuracy: total ? correct / total : 0,
    byVersion: (roll("version", "version") as AccuracyStats["byVersion"]).sort((a, b) => a.version - b.version),
    bySignal: (roll("signal", "signal") as AccuracyStats["bySignal"]).sort((a, b) => b.total - a.total || a.signal.localeCompare(b.signal)),
    byKind: (roll("kind", "kind") as AccuracyStats["byKind"]).sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind)),
  }
}

/* --------------------------------------------------------------------- spec */

const SPEC_SYSTEM = `You write a build SPEC for a solo founder shipping a small mobile app that fills a gap found in app-store reviews.
Default stack: Expo (React Native + TypeScript) + Supabase + RevenueCat + EAS.
Write Markdown with exactly these nine sections, in this order, using these headings:
## 1. Problem in the users' words
Quotes with ids Q1..Qn, each with app, rating and date (use only the quotes provided; never invent quotes).
## 2. Target user and trigger moment
## 3. MVP scope
Exactly 5 features. Each references Q-ids and has one Given/When/Then acceptance criterion.
## 4. Non-goals
## 5. Data model
Supabase SQL including row level security policies.
## 6. Screens and navigation
## 7. Monetization
Paywall placement, price copied from a named competitor if one is known (otherwise say unknown), and trial length.
## 8. Definition of done
## 9. Task plan
Tasks of at most 2 hours each.
Output the Markdown only.`

const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "undated")

export async function generateSpec(
  id: number | string,
  opts: { signal?: AbortSignal; log?: (m: string) => void; onProgress?: (m: string) => void } = {},
) {
  const settings = await getSettings()
  if (!aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")
  const opp = await getOpportunity(id)
  if (!opp) throw new Error("Opportunity not found")
  opts.signal?.throwIfAborted()
  opts.onProgress?.("Writing the spec")

  const weight = (e: Evidence) => (e.wtp_signal && e.wtp_signal !== "none" ? 10 : 0) + (e.pain_score ?? 0)
  const top = [...opp.evidence].sort((a, b) => weight(b) - weight(a)).slice(0, 12)
  const quotes = top.map(
    (e, i) =>
      `Q${i + 1} [${e.app_name ?? "imported"}, ${e.rating !== null ? `${e.rating}★` : e.source}, ${day(e.date)}]: "${(e.evidence_span ?? e.body ?? "").replace(/\s+/g, " ").slice(0, 300)}"`,
  )
  const prompt = [
    `Opportunity: ${opp.label} (${opp.kind})`,
    `Evidence: ${opp.n} reviews/items across ${opp.listings} app listings; average pain ${opp.avg_pain.toFixed(1)}/5.`,
    `Signals: ${Object.entries(opp.signals)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
    `Competitors named: ${opp.competitors.map((c) => `${c.name} (${c.count})`).join(", ") || "none"}`,
    opp.notes ? `Founder notes: ${opp.notes}` : "",
    "",
    "Quotes:",
    ...quotes,
  ]
    .filter((l, i) => l !== "" || i > 0)
    .join("\n")

  let md = await chat(
    settings.ai,
    [
      { role: "system", content: SPEC_SYSTEM },
      { role: "user", content: prompt },
    ],
    { maxTokens: 8000 },
  )
  md = md
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n/i, "")
    .replace(/\n```$/, "")
    .trim()
  if (!md) throw new Error("The model returned an empty spec")
  opts.signal?.throwIfAborted()
  await saveSpec(opp.id, md)
  opts.log?.(`spec saved (${md.length} chars)`)
  return md
}

/* --------------------------------------------------------------- validation */

export interface ValidationKit {
  headline: string
  subheadline: string
  bullets: string[]
  cta: string
  price: string
  thread_reply: string
  waitlist_copy: string
  generated_at: string
}

export interface ValidationMetrics {
  waitlist: number
  price_clicks: number
  replies: number
  started_at: string | null
  recorded_at: string
}

export type ValidationDecision = "proceed" | "kill" | "pending"

const VALIDATION_SYSTEM = `You write a fake-door validation kit (landing copy plus a public thread reply) for a solo founder testing a small mobile app idea found in app-store reviews.
Reply with JSON only, exactly this shape:
{"headline":"…","subheadline":"…","bullets":["…","…","…"],"cta":"Start 7-day trial — $X/mo","price":"$X/mo","thread_reply":"…","waitlist_copy":"…"}
Rules:
- The bullets must paraphrase the real quotes provided; never invent claims or features nobody asked for.
- thread_reply is a public, non-spammy reply for the original thread. It acknowledges the problem and asks whether they would like to try a rough prototype. No links, no hype.
- price is copied from a named competitor when a price is known for one, otherwise "$4.99/mo". The cta uses the same price.
- headline is at most 90 characters, subheadline at most 160, each bullet at most 140.`

const clip = (v: unknown, max: number, field: string) => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""
  if (!t) throw new Error(`The model's validation kit is missing "${field}"`)
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** Checks and truncates a model reply into a kit. Throws when a field is missing. */
export function validateKit(reply: unknown): Omit<ValidationKit, "generated_at"> {
  const r = (reply && typeof reply === "object" ? reply : {}) as Record<string, unknown>
  const raw = Array.isArray(r.bullets) ? r.bullets.filter((b) => typeof b === "string" && b.trim()) : []
  if (raw.length < 3) throw new Error('The model\'s validation kit needs 3 "bullets"')
  return {
    headline: clip(r.headline, 90, "headline"),
    subheadline: clip(r.subheadline, 160, "subheadline"),
    bullets: raw.slice(0, 3).map((b) => clip(b, 140, "bullets")),
    cta: clip(r.cta, 60, "cta"),
    price: clip(r.price, 20, "price"),
    thread_reply: clip(r.thread_reply, 800, "thread_reply"),
    waitlist_copy: clip(r.waitlist_copy, 300, "waitlist_copy"),
  }
}

export async function generateValidation(
  id: number | string,
  opts: { signal?: AbortSignal; log?: (m: string) => void; onProgress?: (m: string) => void } = {},
): Promise<ValidationKit> {
  const settings = await getSettings()
  if (!aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")
  const opp = await getOpportunity(id)
  if (!opp) throw new Error("Opportunity not found")
  opts.signal?.throwIfAborted()
  opts.onProgress?.("Writing the validation kit")

  const weight = (e: Evidence) => (e.wtp_signal && e.wtp_signal !== "none" ? 10 : 0) + (e.pain_score ?? 0)
  const top = [...opp.evidence].sort((a, b) => weight(b) - weight(a)).slice(0, 8)
  const clean = (e: Evidence) => (e.evidence_span ?? e.body ?? "").replace(/\s+/g, " ")
  const quotes = top.map((e, i) => `Q${i + 1} [${e.app_name ?? e.source}]: "${clean(e).slice(0, 300)}"`)
  const prices = [
    ...new Set(opp.evidence.flatMap((e) => (e.body ?? "").match(/\$\s?\d+(?:[.,]\d{1,2})?(?:\s?\/\s?(?:mo|month|yr|year|week))?/gi) ?? [])),
  ].slice(0, 8)
  const prompt = [
    `Opportunity: ${opp.label} (${opp.kind})`,
    `Evidence: ${opp.n} reviews/items; average pain ${opp.avg_pain.toFixed(1)}/5.`,
    `Competitors named: ${opp.competitors.map((c) => `${c.name} (${c.count})`).join(", ") || "none"}`,
    `Price amounts seen in the evidence: ${prices.join(", ") || "none"}`,
    "",
    "Quotes:",
    ...quotes,
  ].join("\n")

  const reply = await chat(
    settings.ai,
    [
      { role: "system", content: VALIDATION_SYSTEM },
      { role: "user", content: prompt },
    ],
    { json: true, maxTokens: 2000 },
  )
  const kit: ValidationKit = { ...validateKit(parseJsonReply<unknown>(reply)), generated_at: new Date().toISOString() }
  opts.signal?.throwIfAborted()
  const sql = db()
  await sql`update opportunities set validation = ${sql.json(kit as never)}, updated_at = now() where id = ${opp.id}`
  opts.log?.("validation kit saved")
  return kit
}

export async function saveValidationMetrics(
  id: number | string,
  m: { waitlist?: number; price_clicks?: number; trial_clicks?: number; replies?: number; started_at?: Date | string | null },
): Promise<ValidationMetrics & { decision: ValidationDecision }> {
  const count = (v: unknown) => Math.max(0, Math.round(Number(v) || 0))
  const started = m.started_at ? new Date(m.started_at) : null
  if (started && Number.isNaN(started.getTime())) throw new Error("Invalid start date")
  const value: ValidationMetrics = {
    waitlist: count(m.waitlist),
    price_clicks: count(m.price_clicks ?? m.trial_clicks),
    replies: count(m.replies),
    started_at: started ? started.toISOString() : null,
    recorded_at: new Date().toISOString(),
  }
  const sql = db()
  const rows = await sql`update opportunities set validation_metrics = ${sql.json(value as never)}, updated_at = now()
    where id = ${oppId(id)} returning id`
  if (!rows.length) throw new Error("Opportunity not found")
  return { ...value, decision: validationDecision(value) }
}

/**
 * proceed: waitlist >= 20 or price clicks >= 5 or replies >= 3.
 * kill: none of those and the test started at least 5 days ago. Otherwise pending.
 */
export function validationDecision(
  metrics: Partial<Pick<ValidationMetrics, "waitlist" | "price_clicks" | "replies" | "started_at">> | null | undefined,
  now = new Date(),
): ValidationDecision {
  if (!metrics) return "pending"
  if ((metrics.waitlist ?? 0) >= 20 || (metrics.price_clicks ?? 0) >= 5 || (metrics.replies ?? 0) >= 3) return "proceed"
  const started = metrics.started_at ? new Date(metrics.started_at).getTime() : NaN
  if (!Number.isNaN(started) && now.getTime() - started >= 5 * 86_400_000) return "kill"
  return "pending"
}

/* -------------------------------------------------------------------- items */

export interface ItemInput {
  body: string
  url?: string | null
  author?: string | null
  appId?: string | null
  source?: string
  postedAt?: Date | string | null
}

/** Stores text from outside the stores. Duplicates (same source and normalised body) are skipped. */
export async function importItems(items: ItemInput[]) {
  const clean = items.map((i) => ({ ...i, body: (i.body ?? "").trim().slice(0, 8000) })).filter((i) => i.body)
  if (clean.length) {
    for (const i of clean) if (i.appId && !/^[0-9a-f-]{36}$/i.test(i.appId)) throw new Error("Invalid app id")
  }
  if (!clean.length) return { inserted: 0, skipped: items.length }
  const sql = db()
  const dates = clean.map((i) => (i.postedAt ? new Date(i.postedAt) : null))
  if (dates.some((d) => d && Number.isNaN(d.getTime()))) throw new Error("Invalid posted_at date")
  const rows = await sql<{ id: number }[]>`
    insert into items (source, url, author, body, app_id, posted_at, content_hash)
    select coalesce(v.source, 'paste'), v.url, v.author, v.body, v.app_id::uuid, v.posted_at::timestamptz,
      md5(lower(regexp_replace(v.body, '\\s+', ' ', 'g')))
    from unnest(
      ${clean.map((i) => i.source?.trim() || "paste")}::text[], ${clean.map((i) => i.url ?? null)}::text[],
      ${clean.map((i) => i.author ?? null)}::text[], ${clean.map((i) => i.body)}::text[],
      ${clean.map((i) => i.appId ?? null)}::text[], ${dates.map((d) => d?.toISOString() ?? null)}::text[]
    ) as v(source, url, author, body, app_id, posted_at)
    on conflict (source, content_hash) do nothing
    returning id::int`
  return { inserted: rows.length, skipped: items.length - rows.length }
}

/**
 * Classifies imported items with the same pass as reviews, then queues label grouping.
 * In Anthropic batch mode the items are submitted to a Message Batch instead
 * (`pollBatches` applies the results and queues the grouping).
 */
export async function analyseItems(
  opts: {
    batchSize?: number
    concurrency?: number
    log?: (m: string) => void
    onProgress?: (m: string) => void
    signal?: AbortSignal
  } = {},
): Promise<{ classified: number; batched?: number }> {
  const settings = await getSettings()
  if (!aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")
  const log = opts.log ?? (() => {})
  if (settings.ai.provider === "anthropic" && settings.ai.batch) {
    opts.onProgress?.("Submitting items to a Message Batch")
    const batched = await submitClassificationBatch("items", null, { batchSize: opts.batchSize })
    log(`submitted ${batched} items to a batch`)
    return { classified: 0, batched }
  }
  const pending = await pendingItems()
  let classified = 0
  let done = 0
  const size = opts.batchSize ?? 20
  const batches = Array.from({ length: Math.ceil(pending.length / size) }, (_, i) => pending.slice(i * size, (i + 1) * size))
  await mapLimit(
    batches,
    opts.concurrency ?? 3,
    async (batch) => {
      const rows = await classifyBatch(settings.ai, batch)
      await applyClassifications("items", null, rows)
      classified += rows.length
      done += batch.length
      log(`classified ${classified}/${pending.length} items`)
      opts.onProgress?.(`Analysing items ${done}/${pending.length}`)
    },
    opts.signal,
  )
  opts.signal?.throwIfAborted()
  if (classified > 0) await enqueue("group_labels")
  return { classified }
}
