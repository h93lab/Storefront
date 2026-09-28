"use server"

import { revalidatePath } from "next/cache"
import {
  addApp,
  addBoardItem,
  createBoard,
  deleteBoard,
  enqueue,
  getSettings,
  parseStoreUrl,
  removeApp,
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
      lang: input.lang || parsed.lang || "en",
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
    const patch: Record<string, unknown> = { baseUrl: input.baseUrl.trim(), model: input.model.trim(), autoAnalyse: input.autoAnalyse }
    // An empty key field means "keep the saved key".
    if (input.apiKey) patch.apiKey = input.apiKey.trim()
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
