import { db } from "./db"

export interface Settings {
  ai: {
    /** `openai` = any OpenAI-compatible /chat/completions endpoint; `anthropic` = the Anthropic Messages API. */
    provider: "openai" | "anthropic"
    /** For anthropic the base URL may be empty (SDK default); kept so tests can point at a fake server. */
    baseUrl: string
    apiKey: string
    model: string
    autoAnalyse: boolean
    /** Anthropic only: classification goes through Message Batches (50% cheaper, asynchronous). */
    batch: boolean
    /** All fields empty = embeddings disabled. */
    embedding: { baseUrl: string; apiKey: string; model: string; dimensions: number }
  }
  sync: { cron: string; reviewsPerApp: number }
  score: { listingWeight: number; painWeight: number; wtpWeight: number; halfLifeDays: number; autoMapThreshold: number }
  reddit: {
    enabled: boolean
    clientId: string
    clientSecret: string
    userAgent: string
    subreddits: string[]
    keywords: string[]
    limit: number
    /** Test override for both the API and the OAuth host. */
    apiBase: string
  }
  /** Appllama (Market) OAuth connection. Tokens never leave the server: client components only see "connected since". */
  appllama: {
    clientId: string
    clientSecret: string
    accessToken: string
    refreshToken: string
    expiresAt: string | null
    scope: string
    connectedAt: string | null
    /** Local daily call counter (day is YYYY-MM-DD, UTC). */
    usage: { day: string; calls: number }
    /** Default "https://mcp.appllama.io/mcp"; tests override. */
    mcpUrl: string
  }
  /** Short-lived state of an OAuth authorisation in flight (PKCE verifier, state, redirect URI). */
  appllama_pending: { verifier: string; state: string; redirectUri: string; createdAt: string }
}

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    provider: "openai",
    baseUrl: "",
    apiKey: "",
    model: "",
    autoAnalyse: true,
    batch: false,
    embedding: { baseUrl: "", apiKey: "", model: "", dimensions: 1024 },
  },
  sync: { cron: "0 3 * * *", reviewsPerApp: 500 },
  score: { listingWeight: 0.5, painWeight: 1, wtpWeight: 2, halfLifeDays: 90, autoMapThreshold: 0.86 },
  reddit: {
    enabled: false,
    clientId: "",
    clientSecret: "",
    userAgent: "",
    subreddits: [],
    keywords: [],
    limit: 50,
    apiBase: "",
  },
  appllama: {
    clientId: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    expiresAt: null,
    scope: "",
    connectedAt: null,
    usage: { day: "", calls: 0 },
    mcpUrl: "https://mcp.appllama.io/mcp",
  },
  appllama_pending: { verifier: "", state: "", redirectUri: "", createdAt: "" },
}

const KEYS = ["ai", "sync", "score", "reddit", "appllama", "appllama_pending"] as const

function merge<K extends keyof Settings>(key: K, stored: unknown): Settings[K] {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>
  const out = { ...DEFAULT_SETTINGS[key], ...s } as Record<string, unknown>
  if (key === "ai") {
    const e = (s.embedding && typeof s.embedding === "object" ? s.embedding : {}) as object
    out.embedding = { ...DEFAULT_SETTINGS.ai.embedding, ...e }
  }
  return out as Settings[K]
}

export async function getSettings(): Promise<Settings> {
  const rows = await db()<{ key: string; value: unknown }[]>`select key, value from settings where key = any(${[...KEYS]}::text[])`
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    ai: merge("ai", map.ai),
    sync: merge("sync", map.sync),
    score: merge("score", map.score),
    reddit: merge("reddit", map.reddit),
    appllama: merge("appllama", map.appllama),
    appllama_pending: merge("appllama_pending", map.appllama_pending),
  }
}

export async function saveSettings<K extends keyof Settings>(key: K, value: Partial<Settings[K]>) {
  const current = (await getSettings())[key]
  const merged = { ...current, ...value } as Settings[K]
  if (key === "ai") {
    const patch = (value as Partial<Settings["ai"]>).embedding
    if (patch) (merged as Settings["ai"]).embedding = { ...(current as Settings["ai"]).embedding, ...patch }
  }
  await db()`insert into settings (key, value) values (${key}, ${db().json(merged as never)})
    on conflict (key) do update set value = excluded.value`
  return merged
}

/** True when the chat provider can be called. Anthropic needs a model and either an API key or a base URL. */
export const aiConfigured = (s: Settings) =>
  Boolean(s.ai.model && (s.ai.provider === "anthropic" ? s.ai.apiKey || s.ai.baseUrl : s.ai.baseUrl))
