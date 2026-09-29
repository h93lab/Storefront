import { chat, parseJsonReply } from "./ai"
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

type PendingReview = { review_id: string; rating: number | null; title: string | null; body: string | null }

const reviewText = (r: PendingReview) => `${r.title ?? ""}\n${r.body ?? ""}`.trim().slice(0, 1200)

async function classifyBatch(cfg: Settings["ai"], batch: PendingReview[]) {
  const payload = batch.map((r) => ({ id: r.review_id, rating: r.rating, text: reviewText(r) }))
  const reply = await chat(
    cfg,
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(payload) },
    ],
    // Each item now carries a verbatim quote, so replies are roughly twice the size they were.
    { json: true, maxTokens: 12_000 },
  )
  const parsed = parseJsonReply<{ items?: (Partial<Classified> & Record<string, unknown>)[] }>(reply)
  const source = new Map(batch.map((r) => [r.review_id, reviewText(r)]))
  return (parsed.items ?? [])
    .map((item) => normaliseItem(item, source.get(String(item?.id ?? ""))))
    .filter((x): x is Classified => x !== null)
}

const CLUSTER_SYSTEM = `You group near-duplicate labels from app reviews. Given complaint and request labels with counts,
merge labels that mean the same thing, sum their counts, and return the top 6 of each, most frequent first.
Then write 2-3 sentences for a designer building a competing app: the clearest opportunities these reviews reveal.
Respond with JSON only: {"complaints":[{"label":"...","count":0}],"requests":[{"label":"...","count":0}],"summary":"..."}`

export interface AnalyseResult {
  classified: number
  reviewsCount: number
}

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
 * Classifies unanalysed reviews in batches, then aggregates the latest reviews
 * into sentiment counts, top complaints/requests and a short summary.
 */
export async function analyseApp(
  appId: string,
  opts: {
    batchSize?: number
    concurrency?: number
    log?: (m: string) => void
    onProgress?: (m: string) => void
    signal?: AbortSignal
  } = {},
): Promise<AnalyseResult> {
  const settings = await getSettings()
  if (!aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")
  const sql = db()
  const log = opts.log ?? (() => {})
  const limit = settings.sync.reviewsPerApp
  const batchSize = opts.batchSize ?? 20

  const pending = await sql<PendingReview[]>`
    select review_id, rating, title, body from (
      select * from reviews where app_id = ${appId} order by reviewed_at desc nulls last limit ${limit}
    ) r where analysed_at is null or analysis_version < ${ANALYSIS_VERSION}`

  // Batches run a few at a time; each batch is saved with a single statement.
  let classified = 0
  let done = 0
  const batches = Array.from({ length: Math.ceil(pending.length / batchSize) }, (_, i) => pending.slice(i * batchSize, (i + 1) * batchSize))
  await mapLimit(
    batches,
    opts.concurrency ?? 3,
    async (batch) => {
      const items = await classifyBatch(settings.ai, batch)
      if (items.length) {
        await sql`
        update reviews r set sentiment = v.sentiment, topic = v.topic, label = nullif(v.label, ''), label_kind = v.kind,
          wtp_signal = v.wtp_signal, competitor_mentioned = v.competitor, workaround = v.workaround, evidence_span = v.evidence,
          pain_score = v.pain, raw_analysis = v.raw, analysis_version = ${ANALYSIS_VERSION}, analysed_at = now()
        from jsonb_to_recordset(${sql.json(items as never)})
          as v(id text, sentiment text, topic text, label text, kind text, wtp_signal text, competitor text, workaround text,
               evidence text, pain smallint, raw jsonb)
        where r.app_id = ${appId} and r.review_id = v.id`
      }
      classified += items.length
      done += batch.length
      log(`classified ${classified}/${pending.length}`)
      opts.onProgress?.(`Analysing reviews ${done}/${pending.length}`)
    },
    opts.signal,
  )
  opts.signal?.throwIfAborted()

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
    return { classified, reviewsCount: 0 }
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
  return { classified, reviewsCount: counts.total }
}
