"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Clock, LoaderCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export interface WatchedJob {
  id: string
  type: string
  status: "queued" | "running"
  progress: string | null
  error: string | null
  run_after: string
}

const LABEL: Record<string, string> = { sync_app: "Syncing", sync_all: "Queuing all apps", analyse_app: "Analysing reviews" }

/**
 * Polls a light endpoint while jobs are active and refreshes the page once
 * one finishes, so the page shows progress without re-rendering every few seconds.
 */
export function JobWatcher({ appId, initial, variant = "banner" }: { appId?: string; initial: WatchedJob[]; variant?: "banner" | "none" }) {
  const router = useRouter()
  const [jobs, setJobs] = React.useState(initial)
  const key = initial.map((j) => j.id).join(",")

  React.useEffect(() => {
    setJobs(initial)
    if (!initial.length) return
    let stopped = false
    let known = new Set(initial.map((j) => j.id))
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs${appId ? `?app=${appId}` : ""}`, { cache: "no-store" })
        if (!res.ok || stopped) return
        const { jobs: next } = (await res.json()) as { jobs: WatchedJob[] }
        setJobs(next)
        const finished = [...known].some((id) => !next.some((j) => j.id === id))
        known = new Set(next.map((j) => j.id))
        if (finished) router.refresh()
      } catch {
        // offline for a moment; try again next tick
      }
    }
    const t = setInterval(tick, 2000)
    return () => {
      stopped = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, appId])

  if (variant === "none" || !jobs.length) return null
  const running = jobs.find((j) => j.status === "running")
  const job = running ?? jobs[0]
  const waitingRetry = job.status === "queued" && new Date(job.run_after).getTime() > Date.now() + 5000
  return (
    <Alert aria-live="polite">
      {waitingRetry ? <Clock /> : <LoaderCircle className="animate-spin" />}
      <AlertTitle>
        {waitingRetry
          ? `${job.type === "analyse_app" ? "AI analysis" : "Sync"} will retry at ${new Date(job.run_after).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : job.status === "queued"
            ? "Waiting for the worker"
            : (LABEL[job.type] ?? "Working")}
      </AlertTitle>
      <AlertDescription>
        {waitingRetry
          ? `The last attempt failed: ${job.error}`
          : job.status === "queued"
            ? "Starts within a few seconds. If it never starts, check that the worker container is running (Settings → Diagnostics)."
            : (job.progress ?? "Starting…")}
        {jobs.length > 1 && <span className="block text-xs">{jobs.length - 1} more job(s) waiting for this app</span>}
      </AlertDescription>
    </Alert>
  )
}
