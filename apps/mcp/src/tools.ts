import fs from "node:fs/promises"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  addApp,
  addBoardItem,
  compareApps,
  createBoard,
  enqueue,
  env,
  getApp,
  getBoard,
  getChanges,
  getInsights,
  getReviews,
  getScreenshot,
  getScreenshots,
  listApps,
  listBoards,
  parseStoreUrl,
  resolveMediaPath,
  signalCounts,
  storeClient,
  topicCounts,
  TOPICS,
  WTP_SIGNALS,
} from "@lens/core"
import { z } from "zod"

const media = (p: string | null | undefined) => (p ? `${env.publicUrl}/media/${p}` : null)
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] })
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] })
const appLink = (id: string) => `${env.publicUrl}/apps/${id}`
const uuid = z.string().uuid()

export function buildServer() {
  const server = new McpServer(
    { name: "storefront-lens", version: "0.1.0" },
    {
      instructions:
        "Storefront Lens is the user's private library of App Store and Google Play apps: listings, screenshots, " +
        "reviews, AI review insights, detected changes and project boards. Start with search_library, then get_app. " +
        "Use view_screenshot to actually look at a screen. Save useful references with save_to_board.",
    },
  )

  server.registerTool(
    "search_library",
    {
      title: "Search library",
      description: "List apps tracked in the library, optionally filtered by text, store or category.",
      inputSchema: {
        query: z.string().optional().describe("Matches name, developer or store id"),
        store: z.enum(["ios", "android", "all"]).optional(),
        category: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, store, category }) => {
      const apps = await listApps({ q: query, store, category })
      return json(
        apps.map((a) => ({
          app_id: a.id,
          name: a.name,
          developer: a.developer,
          store: a.store,
          country: a.country.toUpperCase(),
          category: a.category,
          rating: a.rating,
          ratings_count: a.ratings_count,
          price: a.price,
          status: a.status,
          last_synced_at: a.last_synced_at,
          recent_change: a.recent_change,
          url: appLink(a.id),
        })),
      )
    },
  )

  server.registerTool(
    "get_app",
    {
      title: "Get app",
      description: "Full listing for one app: description, release notes, rating, price, version, counts and an insights summary.",
      inputSchema: { app_id: uuid },
      annotations: { readOnlyHint: true },
    },
    async ({ app_id }) => {
      const a = await getApp(app_id)
      if (!a) return fail(`No app with id ${app_id}. Use search_library to find ids.`)
      const ins = await getInsights(app_id)
      return json({
        app_id: a.id,
        name: a.name,
        developer: a.developer,
        store: a.store,
        store_id: a.store_id,
        country: a.country.toUpperCase(),
        language: a.lang,
        category: a.category,
        rating: a.rating,
        ratings_count: a.ratings_count,
        price: a.price,
        version: a.version,
        updated_on_store: a.updated_at_store,
        size_bytes: a.size_bytes,
        content_rating: a.content_rating,
        store_url: a.store_url,
        description: a.description,
        release_notes: a.release_notes,
        reviews_stored: a.reviews_count,
        screenshots: a.screenshots_count,
        icon_url: media(a.icon_path),
        status: a.status,
        last_error: a.last_error,
        last_synced_at: a.last_synced_at,
        last_sync: a.sync_report,
        url: appLink(a.id),
        insights: ins
          ? { sentiment: ins.sentiment, top_complaints: ins.complaints, top_requests: ins.requests, summary: ins.summary }
          : null,
      })
    },
  )

  server.registerTool(
    "get_screenshots",
    {
      title: "List screenshots",
      description: "Screenshots of an app in store order. Pass include_previous to also get screenshots the app no longer shows.",
      inputSchema: { app_id: uuid, include_previous: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ app_id, include_previous }) => {
      const shots = await getScreenshots(app_id, { includeInactive: include_previous })
      return json(
        shots.map((s) => ({
          screenshot_id: s.id,
          position: s.position + 1,
          device: s.device,
          current: s.active,
          width: s.width,
          height: s.height,
          first_seen_at: s.first_seen_at,
          last_seen_at: s.last_seen_at,
          url: media(s.path),
        })),
      )
    },
  )

  server.registerTool(
    "view_screenshot",
    {
      title: "View screenshot",
      description: "Returns the screenshot image itself so you can look at the design.",
      inputSchema: { screenshot_id: z.string().regex(/^\d+$/) },
      annotations: { readOnlyHint: true },
    },
    async ({ screenshot_id }) => {
      const s = await getScreenshot(screenshot_id)
      const file = s && resolveMediaPath(s.path)
      if (!s || !file) return fail(`No screenshot with id ${screenshot_id}`)
      const data = (await fs.readFile(file)).toString("base64")
      return {
        content: [
          { type: "text" as const, text: `${s.app_name} · screen ${s.position + 1}${s.active ? "" : " (no longer shown on the store)"}` },
          { type: "image" as const, data, mimeType: "image/webp" },
        ],
      }
    },
  )

  server.registerTool(
    "get_reviews",
    {
      title: "Get reviews",
      description: `Stored store reviews, newest first by default. Topics come from the AI pass: ${TOPICS.join(", ")}. Each analysed review also carries a willingness-to-pay signal (${WTP_SIGNALS.join(", ")}), any competitor named, a workaround described, a verbatim evidence quote and a pain score 0-5.`,
      inputSchema: {
        app_id: uuid,
        rating: z.enum(["all", "pos", "neu", "neg"]).optional().describe("pos = 4-5 stars, neu = 3, neg = 1-2"),
        topic: z.string().optional(),
        signal: z
          .enum(["any", ...WTP_SIGNALS])
          .optional()
          .describe("Only reviews with this willingness-to-pay signal; any = every signal except none"),
        query: z.string().optional().describe("Text search in title and body"),
        sort: z.enum(["new", "low", "high"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ app_id, rating, topic, signal, query, sort, limit, offset }) => {
      const [{ rows, total }, topics, signals] = await Promise.all([
        getReviews(app_id, { rating, topic, signal, q: query, sort, limit: limit ?? 50, offset }),
        topicCounts(app_id),
        signalCounts(app_id),
      ])
      return json({
        total,
        returned: rows.length,
        topics,
        signals,
        reviews: rows.map((r) => ({
          review_id: r.review_id,
          rating: r.rating,
          title: r.title,
          body: r.body,
          date: r.reviewed_at,
          version: r.app_version,
          sentiment: r.sentiment,
          topic: r.topic,
          label: r.label,
          wtp_signal: r.wtp_signal,
          competitor: r.competitor_mentioned,
          workaround: r.workaround,
          evidence: r.evidence_span,
          pain: r.pain_score,
        })),
      })
    },
  )

  server.registerTool(
    "get_insights",
    {
      title: "Get review insights",
      description: "AI analysis of an app's latest reviews: sentiment counts, top complaints, top feature requests and a summary.",
      inputSchema: { app_id: uuid },
      annotations: { readOnlyHint: true },
    },
    async ({ app_id }) => {
      const ins = await getInsights(app_id)
      if (!ins) return fail("No insights yet. Configure an AI provider in Settings, then run analysis from the app page or sync the app.")
      return json(ins)
    },
  )

  server.registerTool(
    "get_changes",
    {
      title: "Get changes",
      description: "Detected listing changes (screenshots, description, price, version, name, icon), newest first.",
      inputSchema: {
        app_id: uuid.optional(),
        days: z.number().int().min(1).max(3650).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ app_id, days, limit }) => {
      const rows = await getChanges({ appId: app_id, days, limit: limit ?? 50 })
      return json(
        rows.map((c) => ({
          app_id: c.app_id,
          app: c.app_name,
          field: c.field,
          summary: c.summary,
          detected_at: c.detected_at,
          ...(c.field === "screenshots" ? {} : { old_value: c.old_value, new_value: c.new_value }),
        })),
      )
    },
  )

  server.registerTool(
    "compare_apps",
    {
      title: "Compare apps",
      description: "Side-by-side facts for 2-8 apps: rating, price, version, size, sentiment and top complaint.",
      inputSchema: { app_ids: z.array(uuid).min(2).max(8) },
      annotations: { readOnlyHint: true },
    },
    async ({ app_ids }) => {
      const rows = await compareApps(app_ids)
      return json(
        rows.map((a) => ({
          app_id: a.id,
          name: a.name,
          store: a.store,
          country: a.country.toUpperCase(),
          rating: a.rating,
          ratings_count: a.ratings_count,
          price: a.price,
          version: a.version,
          size_bytes: a.size_bytes,
          reviews_stored: a.reviews_count,
          sentiment: a.insights?.sentiment ?? null,
          top_complaint: a.insights?.complaints?.[0]?.label ?? null,
          top_request: a.insights?.requests?.[0]?.label ?? null,
        })),
      )
    },
  )

  server.registerTool(
    "search_store",
    {
      title: "Search the store",
      description: "Search the App Store or Google Play for apps that are not in the library yet.",
      inputSchema: {
        store: z.enum(["ios", "android"]),
        term: z.string().min(1),
        country: z.string().length(2).optional(),
        limit: z.number().int().min(1).max(25).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ store, term, country, limit }) => {
      try {
        return json(await storeClient(store).search(term, (country ?? "us").toLowerCase(), "en", limit ?? 10))
      } catch (e) {
        return fail(`Store search failed: ${(e as Error).message}`)
      }
    },
  )

  server.registerTool(
    "add_app",
    {
      title: "Add app",
      description: "Add an app by store link or id and queue its first sync (listing, screenshots, reviews). Takes about a minute.",
      inputSchema: {
        link_or_id: z.string().describe("App Store / Google Play link, iOS numeric id, or Android package name"),
        country: z.string().length(2).optional().describe("Storefront country, e.g. US or EG. Defaults to the link's country or US."),
        lang: z
          .string()
          .min(2)
          .max(5)
          .optional()
          .describe("Review language for Google Play, e.g. en or ar. Defaults to the country's main language."),
      },
      annotations: { openWorldHint: true },
    },
    async ({ link_or_id, country, lang }) => {
      const parsed = parseStoreUrl(link_or_id)
      if (!parsed) return fail("That is not an App Store or Google Play link, iOS id or Android package name.")
      const row = await addApp({
        store: parsed.store,
        storeId: parsed.storeId,
        country: country ?? parsed.country ?? "us",
        lang: lang ?? parsed.lang ?? undefined,
      })
      return json({ app_id: row.id, created: row.created, status: "sync queued", url: appLink(row.id) })
    },
  )

  server.registerTool(
    "sync_app",
    {
      title: "Sync app",
      description: "Queue a fresh sync of one app now.",
      inputSchema: { app_id: uuid },
    },
    async ({ app_id }) => {
      if (!(await getApp(app_id))) return fail(`No app with id ${app_id}`)
      const job = await enqueue("sync_app", { appId: app_id })
      return json({ job_id: job, status: "queued" })
    },
  )

  server.registerTool(
    "list_boards",
    {
      title: "List boards",
      description: "Project boards of saved screenshots and reviews.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      json(
        (await listBoards()).map((b) => ({
          board_id: b.id,
          name: b.name,
          description: b.description,
          screenshots: b.screens,
          reviews: b.reviews,
        })),
      ),
  )

  server.registerTool(
    "get_board",
    {
      title: "Get board",
      description: "Everything saved on a board with notes. Use view_screenshot on screenshot items to see them.",
      inputSchema: { board_id: uuid },
      annotations: { readOnlyHint: true },
    },
    async ({ board_id }) => {
      const b = await getBoard(board_id)
      if (!b) return fail(`No board with id ${board_id}`)
      return json({
        board_id: b.id,
        name: b.name,
        description: b.description,
        items: b.items.map((i) =>
          i.kind === "screenshot"
            ? {
                item_id: i.id,
                kind: i.kind,
                app: i.app_name,
                app_id: i.app_id,
                screenshot_id: i.screenshot_id,
                url: media(i.screenshot_path),
                note: i.note,
              }
            : {
                item_id: i.id,
                kind: i.kind,
                app: i.app_name,
                app_id: i.app_id,
                review_id: i.review_id,
                rating: i.review_rating,
                title: i.review_title,
                body: i.review_body,
                note: i.note,
              },
        ),
      })
    },
  )

  server.registerTool(
    "create_board",
    {
      title: "Create board",
      description: "Create a new project board.",
      inputSchema: { name: z.string().min(1).max(120), description: z.string().max(500).optional() },
    },
    async ({ name, description }) => json({ board_id: await createBoard(name, description) }),
  )

  server.registerTool(
    "save_to_board",
    {
      title: "Save to board",
      description: "Save a screenshot (screenshot_id) or a review (app_id + review_id) to a board, with an optional note.",
      inputSchema: {
        board_id: uuid,
        screenshot_id: z.string().regex(/^\d+$/).optional(),
        app_id: uuid.optional(),
        review_id: z.string().optional(),
        note: z.string().max(500).optional(),
      },
    },
    async ({ board_id, screenshot_id, app_id, review_id, note }) => {
      if (!screenshot_id && !(app_id && review_id)) return fail("Pass screenshot_id, or app_id with review_id.")
      if (!(await getBoard(board_id))) return fail(`No board with id ${board_id}`)
      try {
        const id = screenshot_id
          ? await addBoardItem(board_id, { kind: "screenshot", screenshotId: screenshot_id, note })
          : await addBoardItem(board_id, { kind: "review", appId: app_id!, reviewId: review_id!, note })
        return json({ item_id: id, saved: id !== null, note: id === null ? "Already on this board" : undefined })
      } catch (e) {
        return fail((e as Error).message)
      }
    },
  )

  return server
}
