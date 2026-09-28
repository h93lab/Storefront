export const COUNTRIES: [string, string][] = [
  ["us", "United States"],
  ["eg", "Egypt"],
  ["sa", "Saudi Arabia"],
  ["ae", "United Arab Emirates"],
  ["kw", "Kuwait"],
  ["qa", "Qatar"],
  ["jo", "Jordan"],
  ["ma", "Morocco"],
  ["gb", "United Kingdom"],
  ["de", "Germany"],
  ["fr", "France"],
  ["in", "India"],
  ["tr", "Türkiye"],
  ["ca", "Canada"],
  ["au", "Australia"],
  ["br", "Brazil"],
  ["jp", "Japan"],
]

export const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["ar", "Arabic"],
  ["fr", "French"],
  ["de", "German"],
  ["es", "Spanish"],
  ["tr", "Turkish"],
]

export const storeLabel = (s: string) => (s === "ios" ? "App Store" : "Google Play")

export function compact(n: number | null | undefined) {
  if (n == null) return "—"
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)
}

export function bytes(n: number | null | undefined) {
  if (!n) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let v = n
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function ago(d: Date | string | null | undefined) {
  if (!d) return "never"
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 30) return `${days}d ago`
  return date(d)
}

export function date(d: Date | string | null | undefined, withTime = false) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  })
}

export const FIELD_LABELS: Record<string, string> = {
  screenshots: "Screenshots",
  description: "Description",
  price: "Price",
  version: "Version",
  name: "Name",
  icon: "Icon",
  release_notes: "Release notes",
}

export const mediaSrc = (p: string | null | undefined) => (p ? `/media/${p}` : null)
