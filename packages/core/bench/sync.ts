// Times a full first sync + a re-sync of an app with 20 screenshots and 500 reviews.
import sharp from "sharp"
const core = await import("../src/index.ts")
const { migrate } = await import("../src/migrate.ts")
const sql = core.db()
await sql.unsafe("drop schema public cascade; create schema public;")
await migrate(() => {})
const img = await sharp({ create: { width: 1170, height: 2532, channels: 3, background: "#4466aa" } })
  .png()
  .toBuffer()
const imgs = new Map()
const fetchImage = async (u: string) => {
  await new Promise((r) => setTimeout(r, 250)) // CDN latency
  if (!imgs.has(u))
    imgs.set(
      u,
      await sharp(img)
        .modulate({ hue: imgs.size * 15 })
        .png()
        .toBuffer(),
    )
  return imgs.get(u)
}
const listing = {
  storeId: "1",
  name: "Bench",
  developer: "d",
  category: "c",
  description: "x",
  releaseNotes: "",
  price: "Free",
  priceValue: 0,
  currency: "USD",
  rating: 4.5,
  ratingsCount: 1000,
  version: "1",
  updatedAt: new Date(),
  sizeBytes: 1,
  contentRating: "4+",
  url: null,
  iconUrl: "icon",
  screenshots: Array.from({ length: 20 }, (_, i) => ({ url: `shot-${i}`, device: i < 10 ? "phone" : "tablet" })),
}
const reviews = Array.from({ length: 500 }, (_, i) => ({
  id: `r${i}`,
  author: "a",
  rating: (i % 5) + 1,
  title: "t",
  body: "b".repeat(200),
  version: "1",
  date: new Date(Date.now() - i * 3600e3),
}))
const client = {
  listing: async () => {
    await new Promise((r) => setTimeout(r, 400))
    return listing
  },
  reviews: async () => {
    await new Promise((r) => setTimeout(r, 2000))
    return reviews
  },
  search: async () => [],
}
const { id } = await core.addApp({ store: "ios", storeId: "1", country: "us" })
for (const label of ["first sync", "re-sync"]) {
  const t = Date.now()
  await core.syncApp(id, { client: () => client, fetchImage, reviewsPerApp: 500 })
  console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`)
}
await core.closeDb()
