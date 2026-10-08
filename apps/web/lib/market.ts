/** Cheapest USD price for a duration among an app's in-app purchases (client-safe mirror of iapPrices in core). */
export function cheapest(
  iaps: { title?: string; duration?: string; price: number | string }[] | undefined,
  duration: "Monthly" | "Annual",
) {
  let best: number | null = null
  for (const p of iaps ?? []) {
    if (String(p.duration ?? "").toLowerCase() !== duration.toLowerCase()) continue
    const n = typeof p.price === "number" ? p.price : Number(String(p.price).replace(/[^0-9.]/g, ""))
    if (Number.isFinite(n) && n > 0 && (best === null || n < best)) best = n
  }
  return best
}

export const usd = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)

export const SECTION_LABEL: Record<string, string> = {
  "welcome-screen": "Welcome",
  onboarding: "Onboarding",
  paywall: "Paywall",
  "other-tabs": "Inside the app",
}
