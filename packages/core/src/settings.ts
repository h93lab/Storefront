import { db } from "./db"

export interface Settings {
  ai: { baseUrl: string; apiKey: string; model: string; autoAnalyse: boolean }
  sync: { cron: string; reviewsPerApp: number }
}

export const DEFAULT_SETTINGS: Settings = {
  ai: { baseUrl: "", apiKey: "", model: "", autoAnalyse: true },
  sync: { cron: "0 3 * * *", reviewsPerApp: 500 },
}

export async function getSettings(): Promise<Settings> {
  const rows = await db()<{ key: string; value: unknown }[]>`select key, value from settings where key in ('ai', 'sync')`
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    ai: { ...DEFAULT_SETTINGS.ai, ...((map.ai as object) ?? {}) },
    sync: { ...DEFAULT_SETTINGS.sync, ...((map.sync as object) ?? {}) },
  }
}

export async function saveSettings<K extends keyof Settings>(key: K, value: Partial<Settings[K]>) {
  const current = (await getSettings())[key]
  const merged = { ...current, ...value }
  await db()`insert into settings (key, value) values (${key}, ${db().json(merged as never)})
    on conflict (key) do update set value = excluded.value`
  return merged
}

export const aiConfigured = (s: Settings) => Boolean(s.ai.baseUrl && s.ai.model)
