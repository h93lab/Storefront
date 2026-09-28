import type { Store } from "./types"

export interface ParsedStoreUrl {
  store: Store
  storeId: string
  country: string | null
  lang: string | null
}

/**
 * Accepts App Store / Google Play links, or a bare id:
 *   https://apps.apple.com/eg/app/calm-sleep-meditation/id571800810
 *   https://play.google.com/store/apps/details?id=com.calm.android&hl=ar&gl=EG
 *   id571800810 | 571800810 | com.calm.android
 */
export function parseStoreUrl(input: string): ParsedStoreUrl | null {
  const s = input.trim()
  if (!s) return null
  if (/^(id)?\d{6,}$/i.test(s)) return { store: "ios", storeId: s.replace(/^id/i, ""), country: null, lang: null }
  if (/^[a-z][\w]*(\.[\w]+)+$/i.test(s) && !s.includes("/")) return { store: "android", storeId: s, country: null, lang: null }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, "")
  if (host === "apps.apple.com" || host === "itunes.apple.com") {
    const id = url.pathname.match(/id(\d{6,})/)?.[1] ?? url.searchParams.get("id")
    if (!id) return null
    const cc = url.pathname.split("/").filter(Boolean)[0]
    return { store: "ios", storeId: id, country: cc && /^[a-z]{2}$/i.test(cc) ? cc.toLowerCase() : null, lang: null }
  }
  if (host === "play.google.com") {
    const id = url.searchParams.get("id")
    if (!id) return null
    const gl = url.searchParams.get("gl")
    const hl = url.searchParams.get("hl")
    return { store: "android", storeId: id, country: gl ? gl.toLowerCase() : null, lang: hl ? hl.split(/[-_]/)[0].toLowerCase() : null }
  }
  return null
}
