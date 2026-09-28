import { chat, parseJsonReply } from "./ai"
import { db } from "./db"
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

type Sentiment = "positive" | "neutral" | "negative"
type Kind = "complaint" | "request" | "praise" | "other"

interface Classified {
  id: string
  sentiment: Sentiment
  topic: string
  kind: Kind
  label: string
}

const SYSTEM = `You analyse mobile app store reviews for a product designer.
For every review return: sentiment (positive|neutral|negative), topic (one of: ${TOPICS.join(", ")}),
kind (complaint|request|praise|other) and label: a short English phrase (3-7 words) naming the specific
complaint, requested feature or praised aspect, written so similar reviews get the same label
(e.g. "Paywall before trying content", "Offline mode", "Sleep stories quality").
Reviews may be in any language; always answer in English.
Respond with JSON only: {"items":[{"id":"...","sentiment":"...","topic":"...","kind":"...","label":"..."}]}`

export function normaliseItem(raw: Partial<Classified>): Classified | null {
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
  return { id: String(raw.id), sentiment, topic, kind, label }
}

async function classifyBatch(
  cfg: Settings["ai"],
  batch: { review_id: string; rating: number | null; title: string | null; body: string | null }[],
) {
  const payload = batch.map((r) => ({ id: r.review_id, rating: r.rating, text: `${r.title ?? ""}\n${r.body ?? ""}`.trim().slice(0, 1200) }))
  const reply = await chat(
    cfg,
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(payload) },
    ],
    { json: true, maxTokens: 6000 },
  )
  const parsed = parseJsonReply<{ items?: Partial<Classified>[] }>(reply)
  return (parsed.items ?? []).map(normaliseItem).filter((x): x is Classified => x !== null)
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
 * Classifies unanalysed reviews in batches, then aggregates the latest reviews
 * into sentiment counts, top complaints/requests and a short summary.
 */
export async function analyseApp(
  appId: string,
  opts: { batchSize?: number; concurrency?: number; log?: (m: string) => void; onProgress?: (m: string) => void } = {},
): Promise<AnalyseResult> {
  const settings = await getSettings()
  if (!aiConfigured(settings)) throw new Error("AI provider is not configured. Add a base URL and model in Settings.")
  const sql = db()
  const log = opts.log ?? (() => {})
  const limit = settings.sync.reviewsPerApp
  const batchSize = opts.batchSize ?? 40

  const pending = await sql<{ review_id: string; rating: number | null; title: string | null; body: string | null }[]>`
    select review_id, rating, title, body from (
      select * from reviews where app_id = ${appId} order by reviewed_at desc nulls last limit ${limit}
    ) r where analysed_at is null`

  // Batches run a few at a time; each batch is saved with a single statement.
  let classified = 0
  let done = 0
  const batches = Array.from({ length: Math.ceil(pending.length / batchSize) }, (_, i) => pending.slice(i * batchSize, (i + 1) * batchSize))
  await mapLimit(batches, opts.concurrency ?? 3, async (batch) => {
    const items = await classifyBatch(settings.ai, batch)
    if (items.length) {
      await sql`
        update reviews r set sentiment = v.sentiment, topic = v.topic, label = nullif(v.label, ''), label_kind = v.kind, analysed_at = now()
        from unnest(${items.map((i) => i.id)}::text[], ${items.map((i) => i.sentiment)}::text[], ${items.map((i) => i.topic)}::text[],
                    ${items.map((i) => i.label)}::text[], ${items.map((i) => i.kind)}::text[]) as v(id, sentiment, topic, label, kind)
        where r.app_id = ${appId} and r.review_id = v.id`
    }
    classified += items.length
    done += batch.length
    log(`classified ${classified}/${pending.length}`)
    opts.onProgress?.(`Analysing reviews ${done}/${pending.length}`)
  })

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
