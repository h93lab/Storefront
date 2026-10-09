"use server"

import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/auth-server"
import {
  aiConfigured,
  deleteVerdict,
  embed,
  recordVerdict,
  saveValidationMetrics,
  type Settings,
  type VerdictCorrection,
  type VerdictSource,
  addApp,
  addBoardItem,
  appllamaBoard,
  appllamaBoards,
  appllamaSearch,
  disconnectAppllama,
  estimateCredits,
  getMarket,
  type AppllamaSearchParams,
  createBoard,
  deleteBoard,
  enqueue,
  getSettings,
  importItems,
  mergeOpportunities,
  parseStoreUrl,
  recordOutcome,
  saveGate,
  saveSpec,
  setAppOwn,
  setOpportunityStatus,
  updateOpportunity,
  type OpportunityKind,
  type OpportunityStatus,
  removeApp,
  runDiagnostics,
  type Check,
  removeBoardItem,
  saveSettings,
  testConnection,
  updateBoard,
  type NewBoardItem,
} from "@lens/core"

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string }

const run = async <T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> => {
  // The proxy only checks the cookie signature; this also rejects sessions from before a password change.
  if (!(await getSession())) return { ok: false, error: "Your session has expired. Sign in again." }
  try {
    return { ok: true, data: await fn(), message }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function addAppAction(input: { link: string; country?: string; lang?: string }) {
  const parsed = parseStoreUrl(input.link)
  if (!parsed) return { ok: false, error: "Paste an App Store or Google Play link, an iOS id, or an Android package name." } as const
  return run(async () => {
    const row = await addApp({
      store: parsed.store,
      storeId: parsed.storeId,
      country: input.country || parsed.country || "us",
      lang: input.lang || parsed.lang || undefined,
    })
    revalidatePath("/", "layout")
    return row
  })
}

export async function removeAppAction(id: string) {
  return run(async () => {
    await removeApp(id)
    revalidatePath("/", "layout")
  }, "App removed")
}

export async function syncAppAction(appId: string) {
  return run(() => enqueue("sync_app", { appId }), "Sync queued")
}

export async function syncAllAction() {
  return run(() => enqueue("sync_all"), "Sync queued for all apps")
}

export async function analyseAppAction(appId: string) {
  return run(async () => {
    const s = await getSettings()
    if (!aiConfigured(s)) throw new Error("Add an AI provider in Settings first.")
    return enqueue("analyse_app", { appId })
  }, "Analysis queued")
}

/** Re-runs the classifier on every review analysed by an older version (and any never analysed). */
export async function reanalyseAllAction() {
  return run(async () => {
    const s = await getSettings()
    if (!aiConfigured(s)) throw new Error("Add an AI provider in Settings first.")
    return enqueue("analyse_all")
  }, "Re-analysis queued for all apps")
}

export async function createBoardAction(name: string, description?: string) {
  return run(async () => {
    const id = await createBoard(name, description)
    revalidatePath("/", "layout")
    return id
  }, "Board created")
}

export async function updateBoardAction(id: string, name: string, description?: string) {
  return run(async () => {
    await updateBoard(id, name, description)
    revalidatePath("/", "layout")
  }, "Board updated")
}

export async function deleteBoardAction(id: string) {
  return run(async () => {
    await deleteBoard(id)
    revalidatePath("/", "layout")
  }, "Board deleted")
}

export async function saveToBoardAction(boardId: string, item: NewBoardItem) {
  return run(async () => {
    const id = await addBoardItem(boardId, item)
    revalidatePath("/boards", "layout")
    return id
  })
}

export async function removeBoardItemAction(itemId: string) {
  return run(async () => {
    await removeBoardItem(itemId)
    revalidatePath("/boards", "layout")
  }, "Removed from board")
}

export async function saveAiSettingsAction(input: {
  provider: Settings["ai"]["provider"]
  baseUrl: string
  apiKey?: string
  model: string
  autoAnalyse: boolean
  batch: boolean
}) {
  return run(async () => {
    const saved = (await getSettings()).ai
    const provider = input.provider === "anthropic" ? "anthropic" : "openai"
    const baseUrl = input.baseUrl.trim()
    const patch: Record<string, unknown> = {
      provider,
      baseUrl,
      model: input.model.trim(),
      autoAnalyse: input.autoAnalyse,
      batch: provider === "anthropic" && input.batch,
    }
    // An empty key field keeps the saved key, but only for the same provider and host:
    // never send a saved key to a different endpoint.
    if (input.apiKey) patch.apiKey = input.apiKey.trim()
    else if (baseUrl !== saved.baseUrl || provider !== saved.provider) patch.apiKey = ""
    await saveSettings("ai", patch)
    revalidatePath("/settings")
  }, "AI settings saved")
}

export async function clearAiKeyAction() {
  return run(async () => {
    await saveSettings("ai", { apiKey: "" })
    revalidatePath("/settings")
  }, "API key removed")
}

export async function testAiAction(input: { provider: Settings["ai"]["provider"]; baseUrl: string; apiKey?: string; model: string }) {
  return run(async () => {
    const saved = (await getSettings()).ai
    const provider = input.provider === "anthropic" ? "anthropic" : "openai"
    const baseUrl = input.baseUrl.trim()
    const sameTarget = provider === saved.provider && baseUrl === saved.baseUrl
    const r = await testConnection({
      ...saved,
      provider,
      baseUrl,
      model: input.model.trim(),
      apiKey: input.apiKey?.trim() || (sameTarget ? saved.apiKey : ""),
    })
    return r.ms
  })
}

export async function saveEmbeddingSettingsAction(input: { baseUrl: string; apiKey?: string; model: string; dimensions: number }) {
  return run(async () => {
    const saved = (await getSettings()).ai.embedding
    const baseUrl = input.baseUrl.trim()
    const dimensions = Math.round(Number(input.dimensions))
    if (!(dimensions >= 1 && dimensions <= 4096)) throw new Error("Dimensions must be between 1 and 4096.")
    const embedding: Record<string, unknown> = { baseUrl, model: input.model.trim(), dimensions }
    if (input.apiKey) embedding.apiKey = input.apiKey.trim()
    else if (baseUrl !== saved.baseUrl) embedding.apiKey = ""
    await saveSettings("ai", { embedding: embedding as Settings["ai"]["embedding"] })
    revalidatePath("/settings")
  }, "Embedding settings saved")
}

export async function clearEmbeddingKeyAction() {
  return run(async () => {
    await saveSettings("ai", { embedding: { apiKey: "" } as Settings["ai"]["embedding"] })
    revalidatePath("/settings")
  }, "Embedding key removed")
}

/** Embeds "hello" with the form's values (saved key when the field is empty) and returns the vector length. */
export async function testEmbeddingAction(input: { baseUrl: string; apiKey?: string; model: string; dimensions: number }) {
  return run(async () => {
    const saved = (await getSettings()).ai.embedding
    const baseUrl = input.baseUrl.trim()
    const [vec] = await embed(
      {
        baseUrl,
        model: input.model.trim(),
        dimensions: Math.round(Number(input.dimensions)) || saved.dimensions,
        apiKey: input.apiKey?.trim() || (baseUrl === saved.baseUrl ? saved.apiKey : ""),
      },
      ["hello"],
    )
    return vec.length
  })
}

export async function saveScoreSettingsAction(input: Settings["score"]) {
  return run(async () => {
    const num = (v: unknown, name: string, min: number, max: number) => {
      const n = Number(v)
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}.`)
      return n
    }
    await saveSettings("score", {
      listingWeight: num(input.listingWeight, "Listing weight", 0, 100),
      painWeight: num(input.painWeight, "Pain weight", 0, 100),
      wtpWeight: num(input.wtpWeight, "WTP weight", 0, 100),
      halfLifeDays: num(input.halfLifeDays, "Half-life", 1, 3650),
      autoMapThreshold: num(input.autoMapThreshold, "Auto-map threshold", 0.5, 1),
    })
    revalidatePath("/", "layout")
  }, "Scoring saved")
}

export async function saveRedditSettingsAction(input: {
  enabled: boolean
  clientId: string
  clientSecret?: string
  userAgent: string
  subreddits: string[]
  keywords: string[]
  limit: number
}) {
  return run(async () => {
    const limit = Math.round(Number(input.limit))
    if (!(limit >= 1 && limit <= 100)) throw new Error("Limit must be between 1 and 100.")
    const list = (xs: string[], strip: RegExp) => [...new Set(xs.map((x) => x.trim().replace(strip, "")).filter(Boolean))]
    const patch: Record<string, unknown> = {
      enabled: input.enabled,
      clientId: input.clientId.trim(),
      userAgent: input.userAgent.trim(),
      subreddits: list(input.subreddits, /^\/?r\//i),
      keywords: list(input.keywords, /^$/),
      limit,
    }
    // Empty secret keeps the saved one.
    if (input.clientSecret) patch.clientSecret = input.clientSecret.trim()
    await saveSettings("reddit", patch)
    revalidatePath("/settings")
  }, "Reddit settings saved")
}

export async function clearRedditSecretAction() {
  return run(async () => {
    await saveSettings("reddit", { clientSecret: "" })
    revalidatePath("/settings")
  }, "Reddit secret removed")
}

export async function fetchRedditAction() {
  return run(async () => {
    const s = (await getSettings()).reddit
    if (!s.enabled) throw new Error("Enable Reddit and save the settings first.")
    if (!s.clientId || !s.clientSecret || !s.userAgent) throw new Error("Add a client id, secret and user agent first.")
    return enqueue("fetch_reddit")
  }, "Reddit fetch queued")
}

export async function saveSyncSettingsAction(input: { cron: string; reviewsPerApp: number }) {
  return run(async () => {
    const { Cron } = await import("croner")
    try {
      new Cron(input.cron, { paused: true }).stop()
    } catch {
      throw new Error("That schedule is not a valid cron expression.")
    }
    const n = Math.round(input.reviewsPerApp)
    if (!(n >= 50 && n <= 2000)) throw new Error("Reviews per app must be between 50 and 2000.")
    await saveSettings("sync", { cron: input.cron.trim(), reviewsPerApp: n })
    revalidatePath("/settings")
  }, "Sync settings saved. The worker picks them up within a minute.")
}

export async function runDiagnosticsAction(link?: string): Promise<ActionResult<Check[]>> {
  return run(() => runDiagnostics(link?.trim() || undefined))
}

export async function setAppLanguageAction(appId: string, lang: string) {
  return run(async () => {
    if (!/^[a-z]{2,3}$/.test(lang)) throw new Error("Pick a language from the list.")
    const { db } = await import("@lens/core")
    await db()`update apps set lang = ${lang} where id = ${appId}`
    await enqueue("sync_app", { appId })
    revalidatePath(`/apps/${appId}`)
  }, "Review language changed. A sync was queued to fetch reviews in that language.")
}

/* ------------------------------------------------------------ opportunities */

export async function groupLabelsAction() {
  return run(() => enqueue("group_labels"), "Grouping queued")
}

export async function generateSpecAction(id: number) {
  return run(async () => {
    const s = await getSettings()
    if (!aiConfigured(s)) throw new Error("Add an AI provider in Settings first.")
    return enqueue("generate_spec", { opportunityId: id })
  }, "Spec generation queued")
}

export async function saveGateAction(id: number, gate: { checks: Record<string, boolean>; notes?: string }) {
  return run(async () => {
    await saveGate(id, gate)
    revalidatePath(`/opportunities/${id}`)
  }, "Gate saved")
}

export async function saveSpecAction(id: number, md: string) {
  return run(async () => {
    await saveSpec(id, md)
    revalidatePath(`/opportunities/${id}`)
  }, "Spec saved")
}

export async function setOpportunityStatusAction(
  id: number,
  status: OpportunityStatus,
  opts: { reason?: string | null; revisitAfter?: string | null } = {},
) {
  return run(async () => {
    await setOpportunityStatus(id, status, opts)
    revalidatePath("/", "layout")
  }, "Status updated")
}

export async function recordOutcomeAction(
  id: number,
  outcome: { installs?: number; trial_starts?: number; paying?: number; notes?: string },
) {
  return run(async () => {
    await recordOutcome(id, outcome)
    revalidatePath(`/opportunities/${id}`)
  }, "Outcome saved")
}

export async function updateOpportunityAction(id: number, patch: { label?: string; notes?: string | null; kind?: OpportunityKind }) {
  return run(async () => {
    await updateOpportunity(id, patch)
    revalidatePath("/opportunities", "layout")
  }, "Saved")
}

export async function mergeOpportunitiesAction(fromId: number, intoId: number) {
  return run(async () => {
    await mergeOpportunities(fromId, intoId)
    revalidatePath("/", "layout")
  }, "Opportunities merged")
}

export async function importItemsAction(input: { text: string; source: string; url?: string; appId?: string }) {
  return run(async () => {
    const items = input.text
      .split(/\r?\n\s*\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((body) => ({ body, source: input.source, url: input.url?.trim() || null, appId: input.appId || null }))
    if (!items.length) throw new Error("Paste at least one item.")
    const r = await importItems(items)
    if (r.inserted > 0) await enqueue("analyse_items")
    revalidatePath("/", "layout")
    return r
  })
}

export async function setAppOwnAction(appId: string, own: boolean) {
  return run(
    async () => {
      await setAppOwn(appId, own)
      revalidatePath("/", "layout")
    },
    own ? "Marked as your app" : "No longer marked as your app",
  )
}

/* ------------------------------------------------------------ review + validation */

export async function recordVerdictAction(input: {
  source: VerdictSource
  ref: string
  verdict: "correct" | "wrong"
  corrected?: VerdictCorrection | null
  notes?: string | null
}) {
  return run(async () => {
    await recordVerdict(input)
    revalidatePath("/review")
  }, "Verdict saved")
}

export async function deleteVerdictAction(source: VerdictSource, ref: string) {
  return run(async () => {
    await deleteVerdict(source, ref)
    revalidatePath("/review")
  }, "Verdict removed")
}

export async function generateValidationAction(id: number) {
  return run(async () => {
    const s = await getSettings()
    if (!aiConfigured(s)) throw new Error("Add an AI provider in Settings first.")
    return enqueue("generate_validation", { opportunityId: id })
  }, "Validation kit queued")
}

export async function saveValidationMetricsAction(
  id: number,
  m: { waitlist: number; price_clicks: number; replies: number; started_at: string | null },
) {
  return run(async () => {
    await saveValidationMetrics(id, m)
    revalidatePath(`/opportunities/${id}`)
    revalidatePath("/opportunities")
  }, "Metrics saved")
}

/* ------------------------------------------------------------------ Market */

export async function disconnectAppllamaAction() {
  return run(async () => {
    await disconnectAppllama()
    revalidatePath("/", "layout")
  }, "Appllama disconnected")
}

export async function marketSearchAction(params: AppllamaSearchParams) {
  return run(() => appllamaSearch(params))
}

export async function appllamaBoardsAction() {
  return run(() => appllamaBoards())
}

export async function appllamaBoardAction(boardId: string, cursor?: string) {
  return run(() => appllamaBoard(boardId, cursor))
}

/** Queues saving one Appllama app (profile + every screen). Returns the job id and the credit estimate. */
export async function marketSaveAction(input: {
  appllamaId: string
  screens?: boolean
  screensCount?: number | null
  appId?: string | null
}) {
  return run(async () => {
    const id = String(input.appllamaId || "").trim()
    if (!id) throw new Error("Missing Appllama app id")
    const screens = input.screens !== false
    const jobId = await enqueue("market_save", { appllamaId: id, screens, ...(input.appId ? { appId: input.appId } : {}) })
    revalidatePath("/market")
    return { jobId, estimate: screens ? estimateCredits({ screens_count: input.screensCount }) : 1 }
  }, "Saving from Appllama")
}

/** Queues up to 20 apps (screens included). */
export async function marketSaveManyAction(ids: string[]) {
  return run(async () => {
    const list = [...new Set(ids.map((i) => String(i).trim()).filter(Boolean))]
    if (!list.length) throw new Error("Pick at least one app")
    if (list.length > 20) throw new Error("At most 20 apps per batch")
    const jobIds: string[] = []
    for (const appllamaId of list) jobIds.push(await enqueue("market_save", { appllamaId, screens: true }))
    revalidatePath("/market")
    return { queued: jobIds.length }
  }, "Saving from Appllama")
}

export async function marketRefreshAction(appId: string) {
  return run(async () => {
    const m = await getMarket(appId)
    if (!m) throw new Error("This app has no market data yet")
    const jobId = await enqueue("market_refresh", { appId })
    return { jobId, estimate: estimateCredits({ screens_count: m.screens_count }) }
  }, "Refresh queued")
}
