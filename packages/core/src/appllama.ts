import crypto from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { addApp } from "./apps"
import { db } from "./db"
import { downloadImage, storeImage } from "./media"
import { getSettings, saveSettings, type Settings } from "./settings"
import { mapLimit } from "./sync"

/*
 * Appllama (Market) integration: OAuth (dynamic client registration + PKCE), a paced MCP client and the save logic.
 * Never log or return tokens / the client secret; errors below only carry HTTP statuses and server messages.
 */

export const APPLLAMA_HOST = "mcp.appllama.io"
const PER_MINUTE = 80
const DAILY_LIMIT = 390
const SECTION_ORDER = ["welcome-screen", "onboarding", "paywall", "other-tabs"]

/* -------------------------------------------------------------------- OAuth */

export interface AppllamaMetadata {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  revocation_endpoint?: string
  [k: string]: unknown
}

const metaCache = new Map<string, { at: number; meta: AppllamaMetadata }>()

/** OAuth server metadata for the host behind `mcpUrl`, cached for 10 minutes. */
export async function appllamaMetadata(mcpUrl: string): Promise<AppllamaMetadata> {
  const origin = new URL(mcpUrl).origin
  const hit = metaCache.get(origin)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.meta
  const res = await fetch(`${origin}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Appllama OAuth metadata unavailable (HTTP ${res.status})`)
  const meta = (await res.json()) as AppllamaMetadata
  if (!meta.authorization_endpoint || !meta.token_endpoint) throw new Error("Appllama OAuth metadata is incomplete")
  metaCache.set(origin, { at: Date.now(), meta })
  return meta
}

const b64url = (b: Buffer) => b.toString("base64url")

export const appllamaConnected = (s: Settings) => Boolean(s.appllama.accessToken)

async function postForm(url: string, form: Record<string, string>, what: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(20_000),
  })
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const detail = typeof body.error_description === "string" ? body.error_description : typeof body.error === "string" ? body.error : ""
    throw new Error(`Appllama ${what} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`)
  }
  return body
}

/** Registers a client once, remembers a PKCE verifier + state and returns the URL to send the user to. */
export async function beginAppllamaConnect(redirectUri: string): Promise<string> {
  let { appllama } = await getSettings()
  const meta = await appllamaMetadata(appllama.mcpUrl)
  if (!appllama.clientId) {
    const res = await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: "Storefront Lens",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
        scope: "appllama",
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`Appllama client registration failed (HTTP ${res.status})`)
    const reg = (await res.json()) as { client_id?: string; client_secret?: string }
    if (!reg.client_id) throw new Error("Appllama client registration returned no client_id")
    appllama = await saveSettings("appllama", { clientId: reg.client_id, clientSecret: reg.client_secret ?? "" })
  }
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest())
  const state = crypto.randomBytes(16).toString("hex")
  await saveSettings("appllama_pending", { verifier, state, redirectUri, createdAt: new Date().toISOString() })
  const url = new URL(meta.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: appllama.clientId,
    redirect_uri: redirectUri,
    scope: "appllama",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString()
  return url.toString()
}

function tokenPatch(body: Record<string, unknown>, previous?: Settings["appllama"]) {
  const access = typeof body.access_token === "string" ? body.access_token : ""
  if (!access) throw new Error("Appllama returned no access token")
  const expiresIn = Number(body.expires_in)
  return {
    accessToken: access,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : (previous?.refreshToken ?? ""),
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scope: typeof body.scope === "string" ? body.scope : (previous?.scope ?? "appllama"),
  }
}

/** Completes the authorisation: checks `state`, swaps the code for tokens and stores them. */
export async function finishAppllamaConnect({ code, state }: { code: string; state: string }) {
  const { appllama, appllama_pending: p } = await getSettings()
  const fresh = p.createdAt && Date.now() - new Date(p.createdAt).getTime() < 15 * 60_000
  if (!p.state || !p.verifier || !fresh || p.state !== state) {
    throw new Error("Appllama connection expired or the state did not match. Start again from Settings.")
  }
  const meta = await appllamaMetadata(appllama.mcpUrl)
  const body = await postForm(
    meta.token_endpoint,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: p.redirectUri,
      client_id: appllama.clientId,
      client_secret: appllama.clientSecret,
      code_verifier: p.verifier,
    },
    "token exchange",
  )
  await saveSettings("appllama", { ...tokenPatch(body), connectedAt: new Date().toISOString() })
  await saveSettings("appllama_pending", { verifier: "", state: "", redirectUri: "", createdAt: "" })
}

let refreshing: Promise<void> | null = null

/** Exchanges the refresh token for a new access token. Concurrent callers share one request. */
export function refreshAppllamaToken(): Promise<void> {
  refreshing ??= (async () => {
    const { appllama } = await getSettings()
    if (!appllama.refreshToken) throw new Error("Appllama session expired. Reconnect it in Settings.")
    const meta = await appllamaMetadata(appllama.mcpUrl)
    const body = await postForm(
      meta.token_endpoint,
      {
        grant_type: "refresh_token",
        refresh_token: appllama.refreshToken,
        client_id: appllama.clientId,
        client_secret: appllama.clientSecret,
      },
      "token refresh",
    )
    await saveSettings("appllama", tokenPatch(body, appllama))
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

/** Revokes the refresh token (best effort) and forgets the tokens. The registered client is kept. */
export async function disconnectAppllama() {
  const { appllama } = await getSettings()
  if (appllama.refreshToken) {
    try {
      const meta = await appllamaMetadata(appllama.mcpUrl)
      if (meta.revocation_endpoint) {
        await postForm(
          meta.revocation_endpoint,
          {
            token: appllama.refreshToken,
            token_type_hint: "refresh_token",
            client_id: appllama.clientId,
            client_secret: appllama.clientSecret,
          },
          "revocation",
        )
      }
    } catch {
      // revoking is best effort
    }
  }
  await saveSettings("appllama", { accessToken: "", refreshToken: "", expiresAt: null, scope: "", connectedAt: null })
}

/* --------------------------------------------------------------- MCP client */

const callTimes: number[] = []

/** Waits until fewer than 80 calls happened in the last minute. */
async function pace() {
  for (;;) {
    const now = Date.now()
    while (callTimes.length && now - callTimes[0] > 60_000) callTimes.shift()
    if (callTimes.length < PER_MINUTE) break
    await new Promise((r) => setTimeout(r, callTimes[0] + 60_000 - now + 50))
  }
  callTimes.push(Date.now())
}

/** Refuses at the local daily cap, otherwise bumps the counter (atomically; the day resets at UTC midnight). */
async function countCall(s: Settings["appllama"]) {
  const today = new Date().toISOString().slice(0, 10)
  if (s.usage.day === today && s.usage.calls >= DAILY_LIMIT) {
    throw new Error(`Appllama daily limit nearly reached (${s.usage.calls}/400). Try again tomorrow.`)
  }
  const sql = db()
  await sql`
    update settings set value = jsonb_set(value, '{usage}', case when value #>> '{usage,day}' = ${today}
      then jsonb_build_object('day', ${today}::text, 'calls', coalesce((value #>> '{usage,calls}')::int, 0) + 1)
      else jsonb_build_object('day', ${today}::text, 'calls', 1) end)
    where key = 'appllama'`
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const statusOf = (e: unknown) => {
  const code = (e as { code?: unknown })?.code
  if (typeof code === "number" && code >= 400 && code < 600) return code
  const m = /\b(401|402|429)\b/.exec((e as Error)?.message ?? "")
  return m ? Number(m[1]) : 0
}

async function rawCall(mcpUrl: string, token: string, tool: string, args: Record<string, unknown>) {
  const client = new Client({ name: "storefront-lens", version: "1" })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
    )
    const result = (await client.callTool({ name: tool, arguments: args })) as {
      isError?: boolean
      content?: { type: string; text?: string }[]
    }
    const text = result.content?.find((c) => c.type === "text")?.text ?? ""
    if (result.isError) {
      const status = statusOf({ message: text })
      throw new HttpStatusError(status, text || `Appllama ${tool} failed`)
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error(`Appllama ${tool} returned a non-JSON reply`)
    }
  } catch (e) {
    if (e instanceof HttpStatusError) throw e
    const status = statusOf(e)
    if (status) throw new HttpStatusError(status, (e as Error).message)
    throw e
  } finally {
    await client.close().catch(() => {})
  }
}

/** Calls one Appllama tool and returns its parsed JSON. Paced, counted, refreshes the token once on 401. */
export async function appllamaCall<T = any>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  let s = (await getSettings()).appllama
  if (!s.accessToken) throw new Error("Appllama is not connected. Connect it in Settings.")
  if (s.expiresAt && new Date(s.expiresAt).getTime() - Date.now() < 60_000 && s.refreshToken) {
    await refreshAppllamaToken()
    s = (await getSettings()).appllama
  }
  if (tool !== "get_credits") {
    if (new URL(s.mcpUrl).hostname === APPLLAMA_HOST) await pace()
    await countCall(s)
  }
  try {
    try {
      return (await rawCall(s.mcpUrl, s.accessToken, tool, args)) as T
    } catch (e) {
      if (!(e instanceof HttpStatusError) || e.status !== 401) throw e
      await refreshAppllamaToken()
      s = (await getSettings()).appllama
      return (await rawCall(s.mcpUrl, s.accessToken, tool, args)) as T
    }
  } catch (e) {
    const status = e instanceof HttpStatusError ? e.status : 0
    if (status === 401) throw new Error("Appllama rejected the saved login. Reconnect it in Settings.")
    if (status === 402) throw new Error("Appllama credits are used up for this month.")
    if (status === 429) throw new Error("Appllama rate limit reached. Wait a minute and try again.")
    throw e
  }
}

export interface AppllamaCredits {
  period_start?: string
  resets_on?: string
  monthly_credits: number
  bonus_credits: number
  used: number
  remaining: number
  limits: { per_minute: number; per_day: number }
}

/** Credit balance (free). */
export const appllamaCredits = () => appllamaCall<AppllamaCredits>("get_credits")

export interface AppllamaApp {
  app_id: string
  name: string
  subtitle?: string | null
  publisher?: string | null
  categories?: string[]
  rating?: { average: number | null; count: number | null } | null
  category_rank?: { rank: number | null; category: string | null; country?: string; as_of?: string } | null
  revenue?: { display: string | null; monthly_usd: number | null; as_of: string | null } | null
  downloads?: { display: string | null; value: number | null } | null
  in_app_purchases?: { title: string; duration: string; price: number | string }[]
  launched?: string | null
  last_updated?: string | null
  screens_count?: number | null
  videos_count?: number | null
  flows?: { name: string; screens: number }[]
  [k: string]: unknown
}

export type SearchedApp = AppllamaApp & { saved: boolean; library_app_id: string | null }

export interface AppllamaSearchParams {
  query?: string
  sort?: string
  cursor?: string
  launched_after?: string
  launched_before?: string
  downloads_min?: number
  downloads_max?: number
  revenue_min?: number
  revenue_max?: number
  rating_min?: number
  rating_max?: number
  price_min?: number
  price_max?: number
  onboarding_steps_min?: number
  onboarding_steps_max?: number
  board_id?: string
}

/** Marks apps that are saved (have market data) and/or already in the library. */
async function annotate(apps: AppllamaApp[]): Promise<SearchedApp[]> {
  const ids = apps.map((a) => String(a.app_id))
  if (!ids.length) return []
  const rows = await db()<{ store_id: string; id: string; saved: boolean }[]>`
    select a.store_id, a.id::text as id, exists (select 1 from app_market m where m.app_id = a.id) as saved
    from apps a where a.store = 'ios' and a.store_id = any(${ids}::text[])
    union all
    select m.appllama_id, m.app_id::text, true from app_market m where m.appllama_id = any(${ids}::text[])`
  const info = new Map<string, { id: string; saved: boolean }>()
  for (const r of rows) {
    const prev = info.get(r.store_id)
    info.set(r.store_id, { id: prev?.id ?? r.id, saved: Boolean(prev?.saved || r.saved) })
  }
  return apps.map((a) => {
    const hit = info.get(String(a.app_id))
    return { ...a, saved: hit?.saved ?? false, library_app_id: hit?.id ?? null }
  })
}

export async function appllamaSearch(params: AppllamaSearchParams = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""))
  const res = await appllamaCall<{ apps?: AppllamaApp[]; total?: number; next_cursor?: string | null; credits?: unknown }>(
    "search_apps",
    clean,
  )
  return { ...res, apps: await annotate(res.apps ?? []) }
}

export const appllamaBoards = async () =>
  (await appllamaCall<{ boards?: { board_id: string; name: string; kind: string; item_count?: number }[] }>("list_my_boards")).boards ?? []

export async function appllamaBoard(boardId: string, cursor?: string) {
  const res = await appllamaCall<{ apps?: AppllamaApp[]; items?: AppllamaApp[]; next_cursor?: string | null; [k: string]: unknown }>(
    "get_board",
    { board_id: boardId, ...(cursor ? { cursor } : {}) },
  )
  const list = res.apps ?? res.items ?? []
  return { ...res, apps: await annotate(list) }
}

/* ----------------------------------------------------------------- pricing */

export const estimateCredits = (app: { screens_count?: number | null }) => 1 + Math.ceil((app.screens_count ?? 0) / 10)

const priceNumber = (p: unknown) => {
  if (typeof p === "number") return Number.isFinite(p) ? p : null
  const n = Number(String(p ?? "").replace(/[^0-9.]/g, ""))
  return Number.isFinite(n) && n > 0 ? n : null
}

export interface IapPrices {
  monthly: number | null
  annual: number | null
  weekly: number | null
  lifetime: number | null
}

/** Cheapest in-app purchase price per period (USD) from a get_app profile. */
export function iapPrices(profile: { in_app_purchases?: unknown } | null | undefined): IapPrices {
  const out: IapPrices = { monthly: null, annual: null, weekly: null, lifetime: null }
  const list = Array.isArray(profile?.in_app_purchases) ? (profile.in_app_purchases as Record<string, unknown>[]) : []
  const min = (k: keyof IapPrices, v: number | null) => {
    if (v !== null && (out[k] === null || v < out[k])) out[k] = v
  }
  for (const p of list) {
    const price = priceNumber(p?.price)
    const duration = String(p?.duration ?? "").toLowerCase()
    if (duration === "monthly") min("monthly", price)
    else if (duration === "annual") min("annual", price)
    else if (duration === "weekly") min("weekly", price)
    else if (duration === "unknown" && /lifetime/i.test(String(p?.title ?? ""))) min("lifetime", price)
  }
  return out
}

/* ------------------------------------------------------------------ saving */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const int = (v: unknown) => (num(v) === null ? null : Math.round(num(v)!))
const text = (v: unknown) => (typeof v === "string" && v ? v : null)
const dateOf = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const strings = (v: unknown) =>
  Array.isArray(v)
    ? v
        .map((x) =>
          typeof x === "string"
            ? x
            : x && typeof x === "object"
              ? String(
                  (x as Record<string, unknown>).name ??
                    (x as Record<string, unknown>).label ??
                    (x as Record<string, unknown>).type ??
                    JSON.stringify(x),
                )
              : String(x),
        )
        .filter(Boolean)
    : []

export interface SaveMarketOptions {
  screens?: boolean
  log?: (m: string) => void
  onProgress?: (m: string) => void
  signal?: AbortSignal
}

interface RawScreen {
  screen_id: string
  name?: string
  flow?: string
  section?: string
  position?: number
  kind?: string
  media_url?: string
  width?: number
  height?: number
  duration_ms?: number
  dominant_color?: string
  colors?: unknown
  ui_elements?: unknown
}

async function saveMarket(appllamaId: string, opts: SaveMarketOptions & { restart?: boolean }) {
  const id = String(appllamaId).trim()
  if (!/^\d+$/.test(id)) throw new Error("Appllama app id must be numeric")
  const sql = db()
  const log = opts.log ?? (() => {})
  opts.signal?.throwIfAborted()
  opts.onProgress?.("Fetching the app profile")

  const raw = await appllamaCall<AppllamaApp & { hint?: unknown; credits?: unknown }>("get_app", { app_id: id })
  const { hint: _hint, credits: _credits, ...profile } = raw
  let spent = 1

  // 1. the library app (never overwrite store-synced fields)
  let [lib] = await sql<{ id: string }[]>`
    select id from apps where store = 'ios' and store_id = ${id} order by (country = 'us') desc, created_at limit 1`
  if (!lib) lib = await addApp({ store: "ios", storeId: id, country: "us" })
  const appId = lib.id
  const category = text(profile.categories?.[0]) ?? text(profile.category_rank?.category)
  await sql`
    update apps set
      name = case when name = '' then ${text(profile.name) ?? ""} else name end,
      developer = coalesce(nullif(developer, ''), ${text(profile.publisher)}),
      category = coalesce(nullif(category, ''), ${category}),
      description = coalesce(nullif(description, ''), ${text(profile.description)})
    where id = ${appId}`

  // 2. the market row (progress columns are left alone)
  const cols = {
    revenue: num(profile.revenue?.monthly_usd),
    downloads: num(profile.downloads?.value),
    rating: num(profile.rating?.average),
    ratingsCount: int(profile.rating?.count),
    rank: int(profile.category_rank?.rank),
    rankCategory: text(profile.category_rank?.category) ?? category,
    launched: dateOf(profile.launched),
    lastUpdated: dateOf(profile.last_updated),
    screensCount: int(profile.screens_count),
    videosCount: int(profile.videos_count),
  }
  await sql`
    insert into app_market (app_id, appllama_id, profile, revenue_monthly_usd, downloads, rating, ratings_count, category_rank, category,
      launched, last_updated, screens_count, videos_count, credits_spent)
    values (${appId}, ${id}, ${sql.json(profile as never)}, ${cols.revenue}, ${cols.downloads}, ${cols.rating}, ${cols.ratingsCount},
      ${cols.rank}, ${cols.rankCategory}, ${cols.launched}, ${cols.lastUpdated}, ${cols.screensCount}, ${cols.videosCount}, 1)
    on conflict (app_id) do update set
      appllama_id = excluded.appllama_id, profile = excluded.profile, revenue_monthly_usd = excluded.revenue_monthly_usd,
      downloads = excluded.downloads, rating = excluded.rating, ratings_count = excluded.ratings_count,
      category_rank = excluded.category_rank, category = excluded.category, launched = excluded.launched,
      last_updated = excluded.last_updated, screens_count = excluded.screens_count, videos_count = excluded.videos_count,
      fetched_at = now(), credits_spent = app_market.credits_spent + 1`

  // 3. screens, page by page, resumable
  if (opts.screens ?? true) {
    const [state] = await sql<{ cursor: string | null; done: boolean }[]>`
      select screens_cursor as cursor, (screens_fetched_at is not null) as done from app_market where app_id = ${appId}`
    let cursor = opts.restart ? null : state.cursor
    if (opts.restart) await sql`update app_market set screens_cursor = null where app_id = ${appId}`
    const finished = !opts.restart && state.done && !state.cursor
    if (finished) {
      log("screens already saved; use refresh to fetch them again")
    } else {
      let page = 0
      for (;;) {
        opts.signal?.throwIfAborted()
        const res = await appllamaCall<{ screens?: RawScreen[]; next_cursor?: string | null }>("list_app_screens", {
          app_id: id,
          ...(cursor ? { cursor } : {}),
        })
        spent++
        page++
        const screens = res.screens ?? []
        const stored = await mapLimit(
          screens,
          4,
          async (s) => {
            if (s.kind === "video" || !s.media_url) return null
            try {
              return await storeImage(await downloadImage(s.media_url), `${appId}/market`)
            } catch (e) {
              if (opts.signal?.aborted) throw e
              log(`screen ${s.screen_id}: image download failed (${(e as Error).message.replace(/\?.*$/, "")})`)
              return null
            }
          },
          opts.signal,
        )
        if (screens.length) {
          const rows = screens.map((s, i) => ({
            app_id: appId,
            screen_id: String(s.screen_id),
            name: text(s.name),
            flow: text(s.flow),
            section: text(s.section),
            position: int(s.position),
            kind: s.kind === "video" ? "video" : "image",
            path: stored[i]?.path ?? null,
            width: int(s.width) ?? stored[i]?.width ?? null,
            height: int(s.height) ?? stored[i]?.height ?? null,
            duration_ms: int(s.duration_ms),
            dominant_color: text(s.dominant_color),
            colors: strings(s.colors),
            ui_elements: strings(s.ui_elements),
          }))
          await sql`
            insert into app_screens ${sql(rows)}
            on conflict (app_id, screen_id) do update set
              name = excluded.name, flow = excluded.flow, section = excluded.section, position = excluded.position,
              kind = excluded.kind, path = coalesce(excluded.path, app_screens.path), width = excluded.width,
              height = excluded.height, duration_ms = excluded.duration_ms, dominant_color = excluded.dominant_color,
              colors = excluded.colors, ui_elements = excluded.ui_elements, fetched_at = now()`
        }
        cursor = res.next_cursor || null
        await sql`
          update app_market set screens_cursor = ${cursor}, credits_spent = credits_spent + 1,
            screens_synced = (select count(*)::int from app_screens where app_id = ${appId})
          where app_id = ${appId}`
        opts.onProgress?.(`Saved ${page} page${page === 1 ? "" : "s"} of screens`)
        if (!cursor) break
      }
      await sql`update app_market set screens_cursor = null, screens_fetched_at = now() where app_id = ${appId}`
    }
  }

  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from app_screens where app_id = ${appId}`
  log(`saved ${profile.name ?? id}: ${n} screens, ${spent} credits`)
  return { appId, screens: n, creditsSpent: spent }
}

/** Saves an Appllama app: profile, library entry and (by default) every screen, stored locally. Resumes after an interruption. */
export const saveMarketApp = (appllamaId: string, opts: SaveMarketOptions = {}) => saveMarket(appllamaId, opts)

/** Re-fetches the profile and walks all screens again. */
export async function refreshMarketApp(appId: string, opts: SaveMarketOptions = {}) {
  const [m] = await db()<{ appllama_id: string }[]>`select appllama_id from app_market where app_id = ${appId}`
  if (!m) throw new Error("This app has no saved market data")
  return saveMarket(m.appllama_id, { ...opts, restart: true })
}

/* ----------------------------------------------------------------- queries */

export interface MarketScreen {
  id: number
  screen_id: string
  name: string | null
  flow: string | null
  section: string | null
  position: number | null
  kind: string
  path: string | null
  width: number | null
  height: number | null
  duration_ms: number | null
  dominant_color: string | null
  colors: string[]
  ui_elements: string[]
}

const sectionRank = (s: string | null) => {
  const i = SECTION_ORDER.indexOf(s ?? "")
  return i === -1 ? SECTION_ORDER.length : i
}

/** The market row of an app with its screens in journey order (welcome, onboarding, paywall, other tabs; then position). */
export async function getMarket(appId: string) {
  const sql = db()
  const [[market], screens] = await Promise.all([
    sql<
      {
        app_id: string
        appllama_id: string
        profile: AppllamaApp & { [k: string]: any }
        revenue_monthly_usd: number | null
        downloads: number | null
        rating: number | null
        ratings_count: number | null
        category_rank: number | null
        category: string | null
        launched: string | null
        last_updated: string | null
        screens_count: number | null
        videos_count: number | null
        screens_synced: number
        screens_cursor: string | null
        fetched_at: Date
        screens_fetched_at: Date | null
        credits_spent: number
      }[]
    >`
      select app_id::text, appllama_id, profile, revenue_monthly_usd::float8, downloads::float8, rating::float8,
        ratings_count::float8 as ratings_count, category_rank, category, launched::text, last_updated::text,
        screens_count, videos_count, screens_synced, screens_cursor, fetched_at, screens_fetched_at, credits_spent
      from app_market where app_id = ${appId}`,
    sql<MarketScreen[]>`
      select id::int, screen_id, name, flow, section, position, kind, path, width, height, duration_ms, dominant_color, colors, ui_elements
      from app_screens where app_id = ${appId}`,
  ])
  if (!market) return null
  screens.sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
  const sections: { section: string; screens: MarketScreen[] }[] = []
  for (const s of screens) {
    const name = s.section ?? "other-tabs"
    let g = sections[sections.length - 1]
    if (!g || g.section !== name) sections.push((g = { section: name, screens: [] }))
    g.screens.push(s)
  }
  return { ...market, prices: iapPrices(market.profile), screens, sections }
}

export interface MarketSummary {
  app_id: string
  appllama_id: string
  name: string
  revenue_monthly_usd: number | null
  downloads: number | null
  rating: number | null
  ratings_count: number | null
  monthly_price: number | null
  annual_price: number | null
}

/** Compact market facts for a set of apps (those without market data are left out). */
export async function marketSummaryFor(appIds: string[]): Promise<MarketSummary[]> {
  const ids = [...new Set(appIds.filter(Boolean))]
  if (!ids.length) return []
  const rows = await db()<
    {
      app_id: string
      appllama_id: string
      name: string
      revenue: number | null
      downloads: number | null
      rating: number | null
      ratings_count: number | null
      profile: unknown
    }[]
  >`
    select m.app_id::text, m.appllama_id, coalesce(nullif(a.name, ''), m.profile->>'name', a.store_id) as name,
      m.revenue_monthly_usd::float8 as revenue, m.downloads::float8 as downloads, m.rating::float8 as rating,
      m.ratings_count::float8 as ratings_count, m.profile
    from app_market m join apps a on a.id = m.app_id
    where m.app_id = any(${ids}::uuid[]) order by m.revenue_monthly_usd desc nulls last, name`
  return rows.map((r) => {
    const p = iapPrices(r.profile as { in_app_purchases?: unknown })
    return {
      app_id: r.app_id,
      appllama_id: r.appllama_id,
      name: r.name,
      revenue_monthly_usd: r.revenue,
      downloads: r.downloads,
      rating: r.rating,
      ratings_count: r.ratings_count,
      monthly_price: p.monthly,
      annual_price: p.annual,
    }
  })
}

export interface SavedMarketApp extends MarketSummary {
  screens_synced: number
  screens_count: number | null
  screens_fetched_at: Date | null
  fetched_at: Date
}

/** Every app that has market data, newest first (the Market page's "Saved" column). */
export async function listSavedMarket(): Promise<SavedMarketApp[]> {
  const rows = await db()<{ app_id: string }[]>`select app_id::text from app_market order by fetched_at desc`
  const ids = rows.map((r) => r.app_id)
  if (!ids.length) return []
  const sql = db()
  const [summaries, extra] = await Promise.all([
    marketSummaryFor(ids),
    sql<{ app_id: string; screens_synced: number; screens_count: number | null; screens_fetched_at: Date | null; fetched_at: Date }[]>`
      select app_id::text, screens_synced, screens_count, screens_fetched_at, fetched_at from app_market`,
  ])
  const by = new Map(summaries.map((s) => [s.app_id, s]))
  const ex = new Map(extra.map((e) => [e.app_id, e]))
  return ids.flatMap((id) => {
    const s = by.get(id)
    const e = ex.get(id)
    return s && e ? [{ ...s, ...e }] : []
  })
}

/** Rule of thumb for the gate's Demand check; "unknown" never means "fail". */
export function demandHint(o: {
  n: number
  listings: number
  apps?: { rating: number | null; ratings_count: number | null }[]
}): "pass" | "unknown" {
  if (o.n >= 15 && o.listings >= 2) return "pass"
  const weak = (o.apps ?? []).some((a) => (a.ratings_count ?? 0) >= 1000 && a.rating !== null && a.rating <= 3.8)
  return weak ? "pass" : "unknown"
}
