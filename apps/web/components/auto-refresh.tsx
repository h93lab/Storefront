"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

/** Refreshes server data on an interval while something is in progress. */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter()
  React.useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(t)
  }, [active, intervalMs, router])
  return null
}
