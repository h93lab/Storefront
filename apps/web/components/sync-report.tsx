import Link from "next/link"
import { AlertTriangle, CircleCheck, CircleX } from "lucide-react"
import type { SyncReport } from "@lens/core"
import { SyncButton } from "@/components/sync-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ago } from "@/lib/format"

/** Problems from the last sync, shown above the tabs so they are never missed. */
export function SyncIssues({
  appId,
  report,
  status,
  lastError,
  busy,
}: {
  appId: string
  report: SyncReport | null
  status: string
  lastError: string | null
  busy: boolean
}) {
  if (busy) return null
  const failed = status === "error"
  const warnings = report?.warnings ?? []
  if (!failed && !warnings.length) return null
  return (
    <Alert variant={failed ? "destructive" : "default"} className={failed ? undefined : "border-warning/50"}>
      <AlertTriangle className={failed ? undefined : "text-warning"} />
      <AlertTitle>{failed ? "Last sync failed" : "Last sync finished with problems"}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-0.5 pl-4">
          {failed && <li>{lastError ?? report?.error ?? "Unknown error"}</li>}
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        {report?.notes?.length ? <p className="mt-1 text-xs">{report.notes.join(" · ")}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <SyncButton appId={appId} label="Sync again" />
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings#diagnostics">Run diagnostics</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

export function SyncReportCard({ report, lastSyncedAt }: { report: SyncReport | null; lastSyncedAt: Date | null }) {
  if (!report) return null
  const rows: [string, string][] = [
    ["Finished", `${ago(report.finishedAt)} · took ${(report.durationMs / 1000).toFixed(1)}s`],
    ["Reviews", `${report.reviewsFetched} fetched · ${report.newReviews} new`],
    ["Screenshots", `${report.screenshots} current · ${report.newScreenshots} new`],
    ["Changes", report.changes.length ? report.changes.join("; ") : "None"],
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {report.ok ? <CircleCheck className="size-4 text-success" /> : <CircleX className="size-4 text-destructive" />}
          Last sync
        </CardTitle>
        <CardDescription>{lastSyncedAt ? `Last successful sync ${ago(lastSyncedAt)}` : "No successful sync yet"}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
        {report.notes.length > 0 && <p className="text-xs text-muted-foreground">Sources: {report.notes.join(" · ")}</p>}
      </CardContent>
    </Card>
  )
}
