/**
 * Loads fictional demo apps so the UI can be explored without store access.
 * Uses the real sync pipeline with a fake store client. Safe to re-run.
 *   pnpm seed            add demo data
 *   pnpm seed --reset    remove demo apps first, then add them again
 *   pnpm seed --remove   remove demo apps and stop
 */
import sharp from "sharp"
import { closeDb, db } from "../db"
import { migrate } from "../migrate"
import { removeApp } from "../apps"
import { syncApp } from "../sync"
import type { StoreClient, StoreListing, StoreReview } from "../stores"

interface Demo {
  storeId: string
  store: "ios" | "android"
  country: string
  name: string
  developer: string
  category: string
  hue: number
  price: string
  rating: number
  ratings: number
  description: string
  screens: string[]
}

const DEMOS: Demo[] = [
  {
    storeId: "demo.stillwater",
    store: "ios",
    country: "us",
    name: "Stillwater: Sleep & Calm",
    developer: "Demo Studio",
    category: "Health & Fitness",
    hue: 215,
    price: "Free",
    rating: 4.8,
    ratings: 182000,
    description:
      "Stillwater helps you wind down.\n\n• Guided sessions from 3 to 25 minutes\n• Sleep stories and soundscapes\n• Gentle daily reminders\n\nStart a 7-day free trial, then choose monthly or yearly access.",
    screens: ["Sleep better tonight", "Pick your goal", "Stories that relax", "Track your streak", "Start free trial"],
  },
  {
    storeId: "demo.lingosprint",
    store: "android",
    country: "eg",
    name: "Lingo Sprint",
    developer: "Demo Studio",
    category: "Education",
    hue: 130,
    price: "Free",
    rating: 4.6,
    ratings: 96000,
    description: "Learn a language in five minutes a day with bite-sized lessons, streaks and friendly reminders.",
    screens: ["5 minutes a day", "Choose a language", "Daily streaks", "Practice speaking"],
  },
  {
    storeId: "demo.taskline",
    store: "ios",
    country: "sa",
    name: "Taskline Planner",
    developer: "Demo Studio",
    category: "Productivity",
    hue: 25,
    price: "$4.99",
    rating: 4.7,
    ratings: 24000,
    description: "Plan your day, share lists and never miss a deadline.",
    screens: ["Plan your day", "Shared lists", "Smart reminders", "Widgets"],
  },
  {
    storeId: "demo.stride",
    store: "android",
    country: "ae",
    name: "Stride Run Club",
    developer: "Demo Studio",
    category: "Health & Fitness",
    hue: 5,
    price: "Free",
    rating: 4.5,
    ratings: 51000,
    description: "Track runs, join clubs and train for your next race.",
    screens: ["Run with friends", "Live tracking", "Training plans", "Join a club"],
  },
]

const REVIEW_TEXT: [number, string, string][] = [
  [2, "Paywall hits too early", "I got a subscription screen before I could try a single session. Let me sample first."],
  [5, "Part of my routine", "Ten minutes every morning for months. The reminders are gentle and the streak keeps me going."],
  [1, "Offline mode broke", "Since the last update downloaded sessions don't play on a flight."],
  [4, "Please add Arabic", "Great content but I'd pay more for Arabic narration. My parents would use it too."],
  [3, "Too many notifications", "I like it, but it pings me three times a day even after I turned some off."],
  [5, "Beautiful design", "Everything is calm and clear. The onboarding asked exactly the right questions."],
  [2, "Hard to cancel", "Cancelling the subscription took me ten minutes to find."],
  [4, "Family plan?", "Would love a family plan so my partner can join without a second subscription."],
  [1, "Crashes on start", "App crashes on launch on my older phone."],
  [5, "Worth it", "Best app in this category I have tried. Worth the yearly price."],
]

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")

function screenSvg(d: Demo, title: string) {
  const c1 = `hsl(${d.hue} 70% 48%)`
  const c2 = `hsl(${(d.hue + 30) % 360} 75% 62%)`
  const blocks = [0, 1, 2].map((k) => `<rect x="60" y="${980 + k * 230}" width="1050" height="190" rx="36" fill="#f1f1f4"/>`).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="2532">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="1170" height="2532" fill="#ffffff"/>
    <rect width="1170" height="880" fill="url(#g)"/>
    <text x="80" y="420" font-family="Geist, Helvetica, Arial, sans-serif" font-size="92" font-weight="700" fill="#fff">${x(title)}</text>
    <text x="80" y="540" font-family="Geist, Helvetica, Arial, sans-serif" font-size="46" fill="#ffffffcc">${x(d.name)}</text>
    ${blocks}
    <rect x="60" y="2250" width="1050" height="150" rx="75" fill="${c1}"/>
    <text x="585" y="2345" text-anchor="middle" font-family="Geist, Helvetica, Arial, sans-serif" font-size="52" font-weight="600" fill="#fff">Continue</text>
  </svg>`
}

function iconSvg(d: Demo) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="112" fill="hsl(${d.hue} 70% 48%)"/>
    <text x="256" y="330" text-anchor="middle" font-family="Geist, Helvetica, Arial, sans-serif" font-size="260" font-weight="700" fill="#fff">${x(d.name[0])}</text></svg>`
}

function listingFor(d: Demo, variant: number): StoreListing {
  const screens =
    variant === 0 ? d.screens : [d.screens[d.screens.length - 1], ...d.screens.slice(0, -1)].map((s, i) => (i === 0 ? `${s}!` : s))
  return {
    storeId: d.storeId,
    name: d.name,
    developer: d.developer,
    category: d.category,
    description: d.description,
    releaseNotes: "Bug fixes and performance improvements.",
    price: variant === 1 && d.price !== "Free" ? "$5.99" : d.price,
    priceValue: null,
    currency: "USD",
    rating: d.rating,
    ratingsCount: d.ratings,
    version: variant === 0 ? "3.4.0" : "3.5.0",
    updatedAt: new Date(),
    sizeBytes: 120_000_000,
    contentRating: "4+",
    url: null,
    iconUrl: `demo://icon/${d.storeId}`,
    screenshots: screens.map((s, i) => ({ url: `demo://screen/${d.storeId}/${encodeURIComponent(s)}/${i}`, device: "phone" as const })),
  }
}

function reviewsFor(d: Demo): StoreReview[] {
  return Array.from({ length: 60 }, (_, i) => {
    const [rating, title, body] = REVIEW_TEXT[(i * 7 + d.hue) % REVIEW_TEXT.length]
    return {
      id: `${d.storeId}-${i}`,
      author: `Demo user ${i + 1}`,
      rating,
      title,
      body,
      version: "3.4.0",
      date: new Date(Date.now() - i * 11 * 3600_000),
    }
  })
}

async function renderDemo(url: string): Promise<Buffer> {
  const [, kind, id, title] = url.match(/^demo:\/\/(icon|screen)\/([^/]+)\/?([^/]*)\/?(\d*)$/) ?? []
  const d = DEMOS.find((x) => x.storeId === id)!
  const svg = kind === "icon" ? iconSvg(d) : screenSvg(d, decodeURIComponent(title))
  return sharp(Buffer.from(svg)).png().toBuffer()
}

await migrate(() => {})
const sql = db()
if (process.argv.includes("--reset") || process.argv.includes("--remove")) {
  for (const a of await sql<{ id: string }[]>`select id from apps where store_id like 'demo.%'`) await removeApp(a.id)
  await sql`delete from opportunities where label like 'Demo:%'`
  await sql`delete from boards where name = 'Meditation app · Onboarding' and not exists (select 1 from board_items i where i.board_id = boards.id)`
}
if (process.argv.includes("--remove")) {
  console.log("demo data removed")
  await closeDb()
  process.exit(0)
}

for (const d of DEMOS) {
  const [row] = await sql<{ id: string }[]>`
    insert into apps (store, store_id, country, lang) values (${d.store}, ${d.storeId}, ${d.country}, 'en')
    on conflict (store, store_id, country) do update set lang = 'en' returning id`
  const reviews = reviewsFor(d)
  for (const variant of [0, 1]) {
    const client: StoreClient = {
      listing: async () => listingFor(d, variant),
      reviews: async (_r, max) => reviews.slice(0, max),
      search: async () => [],
    }
    await syncApp(row.id, { client: () => client, fetchImage: renderDemo, reviewsPerApp: 60 })
  }
  // Rating history for the chart: 90 days of gentle drift.
  for (let i = 89; i >= 0; i--) {
    const r = d.rating - 0.12 + ((89 - i) / 89) * 0.1 + Math.sin(i / 5) * 0.015
    await sql`insert into rating_history (app_id, day, rating, ratings_count)
      values (${row.id}, current_date - ${i}::int, ${r.toFixed(3)}, ${Math.round(d.ratings * (0.9 + (89 - i) / 900))})
      on conflict (app_id, day) do nothing`
  }
  // Demo insights so the AI tab has content before a provider is configured.
  const n = reviews.length
  await sql`insert into insights (app_id, model, reviews_count, sentiment, complaints, requests, summary)
    values (${row.id}, 'demo', ${n}, ${sql.json({ positive: 30, neutral: 12, negative: 18 })},
      ${sql.json([
        { label: "Paywall before trying content", count: 14 },
        { label: "Offline playback broken", count: 9 },
        { label: "Too many notifications", count: 7 },
        { label: "Hard to cancel subscription", count: 5 },
      ])},
      ${sql.json([
        { label: "Arabic language support", count: 11 },
        { label: "Family plan", count: 8 },
        { label: "Custom session length", count: 4 },
      ])},
      'Demo summary: users want to try content before paying, and ask for Arabic support that competitors lack.')
    on conflict (app_id) do nothing`
  await sql`update reviews r set sentiment = case when rating >= 4 then 'positive' when rating = 3 then 'neutral' else 'negative' end,
    topic = case when title ilike '%paywall%' or title ilike '%cancel%' then 'Pricing' when title ilike '%crash%' or title ilike '%offline%' then 'Bug'
      when title ilike '%arabic%' or title ilike '%family%' then 'Feature request' when title ilike '%notif%' then 'Notifications' else 'Praise' end,
    analysed_at = now() where app_id = ${row.id} and analysed_at is null`
  console.log(`seeded ${d.name}`)
}

const [{ count }] = await sql<{ count: number }[]>`select count(*)::int from boards`
if (!count) {
  const [b] = await sql<
    { id: string }[]
  >`insert into boards (name, description) values ('Meditation app · Onboarding', 'Demo board: first-run references') returning id`
  const shots = await sql<
    { id: string; app_id: string }[]
  >`select s.id::text, s.app_id from screenshots s join apps a on a.id = s.app_id where a.store_id like 'demo.%' and s.active order by s.position limit 4`
  for (const s of shots)
    await sql`insert into board_items (board_id, kind, app_id, screenshot_id, note) values (${b.id}, 'screenshot', ${s.app_id}, ${s.id}, null)`
  console.log("seeded demo board")
}

// One demo opportunity with two mapped labels, so the opportunity views have content before an AI provider is configured.
const [{ opps }] = await sql<{ opps: number }[]>`select count(*)::int as opps from opportunities where label like 'Demo:%'`
if (!opps) {
  const picked = await sql<{ app_id: string; review_id: string }[]>`
    select r.app_id, r.review_id from reviews r join apps a on a.id = r.app_id
    where a.store_id like 'demo.%' and r.label is null and r.body is not null and r.body <> ''
    order by r.rating, r.reviewed_at desc, r.review_id limit 8`
  if (picked.length >= 2) {
    const labels = ["paywall before trying content", "no free trial to test the app"]
    const rows = picked.map((p, i) => ({ ...p, label: labels[i % 2] }))
    await sql`
      update reviews r set label = v.label, label_kind = 'complaint', evidence_span = left(r.body, 120),
        wtp_signal = case when v.i % 3 = 0 then 'churned' else 'none' end, pain_score = 4, analysed_at = coalesce(r.analysed_at, now())
      from unnest(${rows.map((r) => r.app_id)}::uuid[], ${rows.map((r) => r.review_id)}::text[], ${rows.map((r) => r.label)}::text[],
        ${rows.map((_, i) => i)}::int[]) as v(app_id, review_id, label, i)
      where r.app_id = v.app_id and r.review_id = v.review_id`
    const [o] = await sql<{ id: number }[]>`
      insert into opportunities (label, kind) values ('Demo: try before you pay — meditation apps', 'complaint') returning id::int`
    await sql`insert into opportunity_labels (label, opportunity_id) select unnest(${labels}::text[]), ${o.id} on conflict (label) do nothing`
    console.log("seeded demo opportunity")
  }
}
await closeDb()
