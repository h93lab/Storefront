import { batchResults, chat, createBatch, parseJsonReply, retrieveBatch } from "./ai"
import { db } from "./db"
import { enqueue } from "./jobs"
import { aiConfigured, getSettings, type Settings } from "./settings"
import { mapLimit } from "./sync"

export const TOPICS = [
  "Pricing",
  "Bug",
  "Performance",
  "Feature request",
  "UX",
  "Content",
  "Notifications",
  "Account",
  "Ads",
  "Praise",
  "Other",
] as const

/**
 * Bump when the classifier's output changes shape. Reviews analysed with an
 * older version are picked up again by the next analysis run.
 */
export const ANALYSIS_VERSION = 2

export const WTP_SIGNALS = ["paying_competitor", "churned", "workaround", "stated_wtp", "none"] as const
export type WtpSignal = (typeof WTP_SIGNALS)[number]

type Sentiment = "positive" | "neutral" | "negative"
type Kind = "complaint" | "request" | "praise" | "other"

export interface Classified {
  id: string
  sentiment: Sentiment
  topic: string
  kind: Kind
  label: string
  /** How strongly the reviewer signals they would pay for a fix; `none` for most reviews. */
  wtp_signal: WtpSignal
  /** Another app named in the review, or null. Never inferred. */
  competitor: string | null
  /** What the reviewer does instead of the missing capability, or null. */
  workaround: string | null
  /** A verbatim substring of the review that supports the label, or null. */
  evidence: string | null
  /** 0 = no pain, 5 = blocks the reviewer from using the app. */
  pain: number
  raw: unknown
}

const SYSTEM = `You analyse mobile app store reviews for a product designer looking for gaps in existing apps.
For every review return:
- sentiment: positive|neutral|negative
- topic: one of ${TOPICS.join(", ")}
- kind: complaint|request|praise|other
- label: an English noun phrase of at most 60 characters in the form "<missing capability> — <context>", written so
  similar reviews get the same label (e.g. "Offline mode — sleep stories", "Free sample — before paywall"). No app names.
- wtp_signal: paying_competitor (reviewer says they pay for another app), churned (cancelled, left, or looking for an
  alternative), workaround (describes doing the job another way), stated_wtp (says they would pay for a change), or none.
  Use none unless the review says so explicitly.
- competitor: the other app named in the review, else null. Never guess.
- workaround: the workaround described, at most 80 characters, else null.
- evidence: the exact verbatim substring of the review (at most 200 characters) that supports the label, else null.
- pain: 0-5, how much this problem stops the reviewer from using the app (praise = 0).
Reviews may be in any language; write label and workaround in English, keep evidence in the original language.
Respond with JSON only:
{"items":[{"id":"...","sentiment":"...","topic":"...","kind":"...","label":"...","wtp_signal":"...","competitor":null,"workaround":null,"evidence":null,"pain":0}]}`

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null)

/**
 * Coerces one model item to the fixed vocabularies. `source` is the review text
 * the model saw; an `evidence` quote not found in it verbatim is dropped (the
 * row is kept) so a stored quote is never a paraphrase.
 */
export function normaliseItem(raw: Partial<Classified> & Record<string, unknown>, source?: string): Classified | null {
  if (!raw?.id) return null
  const sentiment = (["positive", "neutral", "negative"] as const).includes(raw.sentiment as Sentiment)
    ? (raw.sentiment as Sentiment)
    : "neutral"
  const kind = (["complaint", "request", "praise", "other"] as const).includes(raw.kind as Kind) ? (raw.kind as Kind) : "other"
  const topic = TOPICS.find((t) => t.toLowerCase() === String(raw.topic ?? "").toLowerCase()) ?? "Other"
  const label = String(raw.label ?? "")
    .trim()
    .replace(/\.$/, "")
    .slice(0, 80)
  const wtp_signal = WTP_SIGNALS.includes(raw.wtp_signal as WtpSignal) ? (raw.wtp_signal as WtpSignal) : "none"
  let evidence = str(raw.evidence, 200)
  if (evidence && source !== undefined && !source.includes(evidence)) evidence = null
  const pain = Math.min(5, Math.max(0, Math.round(Number(raw.pain) || 0)))
  return {
    id: String(raw.id),
    sentiment,
    topic,
    kind,
    label,
    wtp_signal,
    competitor: str(raw.competitor, 80),
    workaround: str(raw.workaround, 80),
    evidence,
    pain,
    raw,
  }
}

export type PendingReview = { review_id: string; rating: number | null; title: string | null; body: string | null }

const reviewText = (r: PendingReview) => `${r.title ?? ""}\n${r.body ?? ""}`.trim().slice(0, 1200)

type RawItem = Partial<Classified> & Record<string, unknown>

// Each item carries a verbatim quote, so replies are roughly twice the size they once were.
const CLASSIFY_MAX_TOKENS = 12_000

/** The user turn for one classification request; shared by the synchronous and the Message Batches paths. */
const classifyUser = (batch: PendingReview[]) =>
  JSON.stringify(batch.map((r) => ({ id: r.review_id, rating: r.rating, text: reviewText(r) })))

/** Parses a classifier reply and normalises its items against the texts the model saw. */
function parseClassification(reply: string, batch: PendingReview[]) {
  const parsed = parseJsonReply<{ items?: RawItem[] }>(reply)
  const source = new Map(batch.map((r) => [r.review_id, reviewText(r)]))
  return (parsed.items ?? [])
    .map((item) => normaliseItem(item, source.get(String(item?.id ?? ""))))
    .filter((x): x is Classified => x !== null)
}

export async function classifyBatch(cfg: Settings["ai"], batch: PendingReview[]) {
  const reply = await chat(
    cfg,
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: classifyUser(batch) },
    ],
    { json: true, maxTokens: CLASSIFY_MAX_TOKENS },
  )
  return parseClassification(reply, batch)
}

export type ClassifyKind = "reviews" | "items"

/** Writes classifier output onto review rows (of one app) or item rows with a single statement. */
export async function applyClassifications(kind: ClassifyKind, appId: string | null, items: Classified[]) {
  if (!items.length) return
  const sql = db()
  const rows = sql.json(items as never)
  if (kind === "reviews") {
    if (!appId) throw new Error("applyClassifications needs an app id for reviews")
    await sql`
      update reviews r set sentiment = v.sentiment, topic = v.topic, label = nullif(v.label, ''), label_kind = v.kind,
        wtp_signal = v.wtp_signal, competitor_mentioned = v.competitor, workaround = v.workaround, evidence_span = v.evidence,
        pain_score = v.pain, raw_analysis = v.raw, analysis_version = ${ANALYSIS_VERSION}, analysed_at = now()
      from jsonb_to_recordset(${rows})
        as v(id text, sentiment text, topic text, label text, kind text, wtp_signal text, competitor text, workaround text,
             evidence text, pain smallint, raw jsonb)
      where r.app_id = ${appId} and r.review_id = v.id`
  } else {
    await sql`
      update items i set sentiment = v.sentiment, topic = v.topic, label = nullif(v.label, ''), label_kind = v.kind,
        wtp_signal = v.wtp_signal, competitor_mentioned = v.competitor, workaround = v.workaround, evidence_span = v.evidence,
        pain_score = v.pain, raw_analysis = v.raw, analysis_version = ${ANALYSIS_VERSION}, analysed_at = now()
      from jsonb_to_recordset(${rows})
        as v(id text, sentiment text, topic text, label text, kind text, wtp_signal text, competitor text, workaround text,
             evidence text, pain smallint, raw jsonb)
      where i.id::text = v.id`
  }
}

const chunk = <T>(xs: T[], size: number) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size))

/** Reviews of the app's latest `limit` that the current classifier version has not seen. */
const pendingReviews = (appId: string, limit: number) =>
  db()<PendingReview[]>`
    select review_id, rating, title, body from (
      select * from reviews where app_id = ${appId} order by reviewed_at desc nulls last limit ${limit}
    ) r where analysed_at is null or analysis_version < ${ANALYSIS_VERSION}`

export const pendingItems = () =>
  db()<PendingReview[]>`
    select id::text as review_id, null::int as rating, null::text as title, body from items
    where analysed_at is null or analysis_version < ${ANALYSIS_VERSION} order by id`

const CLUSTER_SYSTEM = `You group near-duplicate labels from app reviews. Given complaint and request labels with counts,
merge labels that mean the same thing, sum their counts, and return the top 6 of each, most frequent first.
Then write 2-3 sentences for a designer building a competing app: the clearest opportunities these reviews reveal.
Respond with JSON only: {"complaints":[{"label":"...","count":0}],"requests":[{"label":"...","count":0}],"summary":"..."}`

export interface AnalyseResult {
  classified: number
  reviewsCount: number
  /** Batch mode only: reviews submitted to a Message Batch (classification finishes in `pollBatches`). */
  batched?: number
}

type RunOpts = {
  batchSize?: number
  concurrency?: number
  log?: (m: string) => void
  onProgress?: (m: string) => void
  signal?: AbortSignal
}

const batchMode = (s: Settings) => s.ai.provider === "anthropic" && s.ai.batch

/**
 * Queues an `analyse_app` job for every app with reviews not yet analysed by
 * the current ANALYSIS_VERSION. Returns how many apps were queued.
 */
export async function queueReanalysis() {
  const apps = await db()<{ app_id: string }[]>`
    select distinct app_id from reviews where analysed_at is null or analysis_version < ${ANALYSIS_VERSION}`
  for (const a of apps) await enqueue("analyse_app", { appId: a.app_id })
  return apps.length
}

/**
 * Classifies an app's unanalysed reviews a few requests at a time; each request
 * is saved with a single statement. `pending` is how many reviews were waiting
 * when the run started.
 */
export async function classifyApp(appId: string, opts: RunOpts = {}): Promise<{ classified: number; pending: number }> {
  const settings = await getSettings()
  if (!aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")
  const log = opts.log ?? (() => {})
  const pending = await pendingReviews(appId, settings.sync.reviewsPerApp)

  let classified = 0
  let done = 0
  await mapLimit(
    chunk(pending, opts.batchSize ?? 20),
    opts.concurrency ?? 3,
    async (batch) => {
      const items = await classifyBatch(settings.ai, batch)
      await applyClassifications("reviews", appId, items)
      classified += items.length
      done += batch.length
      log(`classified ${classified}/${pending.length}`)
      opts.onProgress?.(`Analysing reviews ${done}/${pending.length}`)
    },
    opts.signal,
  )
  opts.signal?.throwIfAborted()
  if (classified > 0) await enqueue("group_labels")
  return { classified, pending: pending.length }
}

/** Aggregates the latest analysed reviews into sentiment counts, top complaints/requests and a short summary. */
export async function summariseApp(appId: string, opts: Pick<RunOpts, "log" | "onProgress" | "signal"> = {}) {
  const settings = await getSettings()
  if (!aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")
  const sql = db()
  const log = opts.log ?? (() => {})
  const limit = settings.sync.reviewsPerApp

  opts.onProgress?.("Summarising complaints and requests")
  const recent = sql`select * from reviews where app_id = ${appId} and analysed_at is not null order by reviewed_at desc nulls last limit ${limit}`
  const [counts] = await sql<{ positive: number; neutral: number; negative: number; total: number }[]>`
    select count(*) filter (where sentiment = 'positive')::int as positive,
           count(*) filter (where sentiment = 'neutral')::int as neutral,
           count(*) filter (where sentiment = 'negative')::int as negative,
           count(*)::int as total
    from (${recent}) r`
  if (!counts.total) {
    await sql`delete from insights where app_id = ${appId}`
    return { reviewsCount: 0 }
  }
  const labels = await sql<{ kind: string; label: string; count: number }[]>`
    select label_kind as kind, lower(label) as label, count(*)::int as count
    from (${recent}) r where label is not null and label_kind in ('complaint', 'request')
    group by 1, 2 order by count desc limit 120`

  const raw = {
    complaints: labels.filter((l) => l.kind === "complaint").map(({ label, count }) => ({ label, count })),
    requests: labels.filter((l) => l.kind === "request").map(({ label, count }) => ({ label, count })),
  }
  let clusters: { complaints: { label: string; count: number }[]; requests: { label: string; count: number }[]; summary: string }
  try {
    const reply = await chat(
      settings.ai,
      [
        { role: "system", content: CLUSTER_SYSTEM },
        { role: "user", content: JSON.stringify(raw) },
      ],
      { json: true, maxTokens: 1500 },
    )
    const p = parseJsonReply<typeof clusters>(reply)
    const clean = (xs: unknown) =>
      (Array.isArray(xs) ? xs : [])
        .map((x) => ({ label: String(x?.label ?? "").slice(0, 80), count: Math.max(0, Math.round(Number(x?.count) || 0)) }))
        .filter((x) => x.label)
        .slice(0, 6)
    clusters = { complaints: clean(p.complaints), requests: clean(p.requests), summary: String(p.summary ?? "").slice(0, 1200) }
  } catch (e) {
    log(`clustering failed, using raw labels: ${(e as Error).message}`)
    clusters = { complaints: raw.complaints.slice(0, 6), requests: raw.requests.slice(0, 6), summary: "" }
  }

  await sql`
    insert into insights (app_id, generated_at, model, reviews_count, sentiment, complaints, requests, summary)
    values (${appId}, now(), ${settings.ai.model}, ${counts.total},
      ${sql.json({ positive: counts.positive, neutral: counts.neutral, negative: counts.negative })},
      ${sql.json(clusters.complaints as never)}, ${sql.json(clusters.requests as never)}, ${clusters.summary})
    on conflict (app_id) do update set generated_at = excluded.generated_at, model = excluded.model,
      reviews_count = excluded.reviews_count, sentiment = excluded.sentiment, complaints = excluded.complaints,
      requests = excluded.requests, summary = excluded.summary`
  return { reviewsCount: counts.total }
}

/**
 * Classifies unanalysed reviews, then summarises them. With the Anthropic
 * provider in batch mode the reviews are submitted to a Message Batch instead
 * and `pollBatches` summarises when the results land.
 */
export async function analyseApp(appId: string, opts: RunOpts = {}): Promise<AnalyseResult> {
  const settings = await getSettings()
  if (!aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")
  if (batchMode(settings)) {
    opts.onProgress?.("Submitting reviews to a Message Batch")
    const batched = await submitClassificationBatch("reviews", appId, opts)
    opts.log?.(`submitted ${batched} reviews to a batch`)
    return { classified: 0, reviewsCount: 0, batched }
  }
  const { classified } = await classifyApp(appId, opts)
  const { reviewsCount } = await summariseApp(appId, opts)
  return { classified, reviewsCount }
}

/* ---------------------------------------------------------- message batches */

const BATCH_REQUEST_SIZE = 20

/**
 * Submits everything not yet classified to the Anthropic Message Batches API
 * (20 rows per request, the same payloads as `classifyBatch`) and records it in
 * `ai_batches`. Returns the number of rows submitted; 0 (without calling the
 * provider) when nothing is pending or a batch for the same target is still in flight.
 */
export async function submitClassificationBatch(
  kind: ClassifyKind,
  appId?: string | null,
  opts: { batchSize?: number } = {},
): Promise<number> {
  const settings = await getSettings()
  if (!aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")
  const sql = db()
  if (kind === "reviews" && !appId) throw new Error("An app id is required to batch reviews")
  const target = kind === "reviews" ? appId! : null

  // Rows already sitting in an open batch would be paid for twice.
  const [open] = await sql<{ id: number }[]>`
    select id::int from ai_batches
    where status = 'submitted' and kind = ${kind} and app_id is not distinct from ${target}::uuid limit 1`
  if (open) return 0

  const pending = kind === "reviews" ? await pendingReviews(target!, settings.sync.reviewsPerApp) : await pendingItems()
  if (!pending.length) return 0

  const groups = chunk(pending, opts.batchSize ?? BATCH_REQUEST_SIZE).map((rows, i) => ({
    custom_id: `req-${i}`,
    ids: rows.map((r) => r.review_id),
    rows,
  }))
  const providerId = await createBatch(
    settings.ai,
    groups.map((g) => ({ custom_id: g.custom_id, system: SYSTEM, user: classifyUser(g.rows), maxTokens: CLASSIFY_MAX_TOKENS })),
  )
  const payload = { requests: groups.map(({ custom_id, ids }) => ({ custom_id, ids })) }
  await sql`
    insert into ai_batches (provider_batch_id, kind, app_id, request_count, payload)
    values (${providerId}, ${kind}, ${target}, ${groups.length}, ${sql.json(payload as never)})`
  return pending.length
}

interface BatchRow {
  id: number
  provider_batch_id: string
  kind: ClassifyKind
  app_id: string | null
  payload: { requests: { custom_id: string; ids: string[] }[] }
}

/** Current texts for the given ids, shaped like the pending rows the model was shown. */
async function textsFor(kind: ClassifyKind, appId: string | null, ids: string[]) {
  const sql = db()
  if (kind === "reviews") {
    return sql<PendingReview[]>`
      select review_id, rating, title, body from reviews where app_id = ${appId} and review_id = any(${ids}::text[])`
  }
  return sql<PendingReview[]>`
    select id::text as review_id, null::int as rating, null::text as title, body from items
    where id = any(${ids.filter((i) => /^\d+$/.test(i))}::bigint[])`
}

/**
 * Checks every submitted Message Batch. Ended batches have their results
 * applied (evidence quotes re-checked against the stored text); rows the
 * provider could not answer keep `analysed_at` null so the next run retries
 * them. A reviews batch is followed by `summariseApp`, both kinds by `group_labels`.
 */
export async function pollBatches(opts: { log?: (m: string) => void; signal?: AbortSignal } = {}) {
  const log = opts.log ?? (() => {})
  const sql = db()
  const settings = await getSettings()
  const open = await sql<BatchRow[]>`
    select id::int, provider_batch_id, kind, app_id::text as app_id, payload from ai_batches
    where status = 'submitted' order by id`
  let ended = 0
  for (const row of open) {
    opts.signal?.throwIfAborted()
    let status
    try {
      status = (await retrieveBatch(settings.ai, row.provider_batch_id)).status
    } catch (e) {
      log(`batch ${row.provider_batch_id}: ${(e as Error).message}`)
      continue // transient; try again on the next poll
    }
    if (status !== "ended") continue

    const requests = new Map(row.payload.requests.map((r) => [r.custom_id, r.ids]))
    let succeeded = 0
    const errors: string[] = []
    let applied = 0
    try {
      for await (const r of batchResults(settings.ai, row.provider_batch_id)) {
        const ids = requests.get(r.custom_id)
        if (!ids) continue
        if (!r.ok) {
          errors.push(`${r.custom_id}: ${r.error}`)
          continue
        }
        try {
          const texts = await textsFor(row.kind, row.app_id, ids)
          const items = parseClassification(r.text ?? "", texts)
          await applyClassifications(row.kind, row.app_id, items)
          applied += items.length
          succeeded++
        } catch (e) {
          errors.push(`${r.custom_id}: ${(e as Error).message}`)
        }
      }
    } catch (e) {
      errors.push((e as Error).message)
    }
    const failed = succeeded === 0 && errors.length > 0
    const error = errors.length ? errors.join("; ").slice(0, 1000) : null
    const marked = await sql`
      update ai_batches set status = ${failed ? "failed" : "ended"}, error = ${error}, ended_at = now()
      where id = ${row.id} and status = 'submitted' returning id`
    if (!marked.length) continue // another poller got there first
    ended++
    log(`batch ${row.provider_batch_id} ${failed ? "failed" : "ended"}: ${applied} classified${error ? `, ${error}` : ""}`)
    if (failed) continue
    if (applied > 0) await enqueue("group_labels")
    if (row.kind === "reviews" && row.app_id) {
      try {
        await summariseApp(row.app_id, { log })
      } catch (e) {
        log(`summary failed for ${row.app_id}: ${(e as Error).message}`)
      }
    }
  }
  return { polled: open.length, ended }
}
