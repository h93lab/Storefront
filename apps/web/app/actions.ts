"use server"

import { revalidatePath } from "next/cache"
import {
  addApp,
  addBoardItem,
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
    if (!s.ai.baseUrl || !s.ai.model) throw new Error("Add an AI provider in Settings first.")
    return enqueue("analyse_app", { appId })
  }, "Analysis queued")
}

/** Re-runs the classifier on every review analysed by an older version (and any never analysed). */
export async function reanalyseAllAction() {
  return run(async () => {
    const s = await getSettings()
    if (!s.ai.baseUrl || !s.ai.model) throw new Error("Add an AI provider in Settings first.")
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

export async function saveAiSettingsAction(input: { baseUrl: string; apiKey?: string; model: string; autoAnalyse: boolean }) {
  return run(async () => {
    const saved = (await getSettings()).ai
    const baseUrl = input.baseUrl.trim()
    const patch: Record<string, unknown> = { baseUrl, model: input.model.trim(), autoAnalyse: input.autoAnalyse }
    // An empty key field keeps the saved key, but only for the same provider:
    // never send a saved key to a different host.
    if (input.apiKey) patch.apiKey = input.apiKey.trim()
    else if (baseUrl !== saved.baseUrl) patch.apiKey = ""
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

export async function testAiAction(input: { baseUrl: string; apiKey?: string; model: string }) {
  return run(async () => {
    const saved = (await getSettings()).ai
    const r = await testConnection({
      ...saved,
      baseUrl: input.baseUrl.trim(),
      model: input.model.trim(),
      apiKey: input.apiKey?.trim() || saved.apiKey,
    })
    return r.ms
  })
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
    if (!s.ai.baseUrl || !s.ai.model) throw new Error("Add an AI provider in Settings first.")
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
