import Link from "next/link"
import { ChevronRight, CircleCheck, CircleX, LoaderCircle } from "lucide-react"
import { dashboardStats, getChanges, recentJobs } from "@lens/core"
import { AppIcon } from "@/components/app-icon"
import { AutoRefresh } from "@/components/auto-refresh"
import { ReviewsPerDayChart } from "@/components/charts"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { SyncButton } from "@/components/sync-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ago, date, FIELD_LABELS } from "@/lib/format"
import { AddAppDialog } from "@/components/add-app-dialog"

const JOB_LABEL: Record<string, string> = { sync_app: "Sync app", sync_all: "Sync all apps", analyse_app: "Analyse reviews" }

export default async function DashboardPage() {
  const [stats, changes, jobs] = await Promise.all([dashboardStats(), getChanges({ limit: 6 }), recentJobs(8)])
  const busy = jobs.some((j) => j.status === "queued" || j.status === "running")

  if (!stats.apps) {
    return (
      <>
        <PageHeader title="Dashboard" description="What happened across your tracked apps since the last sync." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Your library is empty</EmptyTitle>
            <EmptyDescription>
              Add an app from the App Store or Google Play to start collecting screenshots, reviews and changes.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <AddAppDialog />
          </EmptyContent>
        </Empty>
      </>
    )
  }

  const sentimentTotal = stats.positive + stats.neutral + stats.negative
  const negShare = sentimentTotal ? Math.round((stats.negative / sentimentTotal) * 100) : null
  const delta = stats.reviews_prev_7d_avg
    ? Math.round(((stats.reviews_24h - stats.reviews_prev_7d_avg) / stats.reviews_prev_7d_avg) * 100)
    : null
  const totalPerDay = stats.perDay.reduce((s, d) => s + d.count, 0)

  return (
    <>
      <AutoRefresh active={busy} />
      <PageHeader title="Dashboard" description="What happened across your tracked apps since the last sync.">
        <SyncButton label="Sync all now" busy={busy} />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Apps tracked"
          value={stats.apps}
          hint={`${stats.ios} App Store · ${stats.android} Google Play${stats.errors ? ` · ${stats.errors} with errors` : ""}`}
          tone={stats.errors ? "bad" : undefined}
        />
        <StatCard
          label="New reviews · 24h"
          value={stats.reviews_24h.toLocaleString()}
          hint={delta == null ? "Collected in the last day" : `${delta >= 0 ? "+" : ""}${delta}% vs 7-day average`}
          tone={delta != null && delta > 0 ? "good" : undefined}
        />
        <StatCard label="Changes · 7 days" value={stats.changes_7d} hint="Screenshots, text, price, version" />
        <StatCard
          label="Negative share"
          value={negShare == null ? "—" : `${negShare}%`}
          hint={negShare == null ? "Needs AI analysis (Settings)" : `Across ${sentimentTotal.toLocaleString()} analysed reviews`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Reviews posted per day</CardTitle>
            <CardDescription>All tracked apps · last 30 days · {totalPerDay.toLocaleString()} stored</CardDescription>
          </CardHeader>
          <CardContent>
            <ReviewsPerDayChart data={stats.perDay} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent changes</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/changes">View all</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-1">
            {changes.length === 0 && (
              <p className="text-sm text-muted-foreground">No changes detected yet. Changes appear after the second sync of an app.</p>
            )}
            {changes.map((c) => (
              <Link
                key={c.id}
                href={`/apps/${c.app_id}?tab=changes`}
                className="-mx-2 flex items-center gap-3 rounded-md p-2 hover:bg-accent"
              >
                <AppIcon name={c.app_name} path={c.app_icon} className="size-8" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.app_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {FIELD_LABELS[c.field] ?? c.field} · {ago(c.detected_at)}
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="pb-2">
        <CardHeader>
          <CardTitle>Sync activity</CardTitle>
          <CardDescription>Jobs run by the worker container on your server</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {jobs.length === 0 ? (
            <p className="px-6 pb-4 text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="pr-6">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="pl-6 font-medium">{JOB_LABEL[j.type] ?? j.type}</TableCell>
                    <TableCell>
                      {j.status === "succeeded" && (
                        <span className="inline-flex items-center gap-1.5 text-success">
                          <CircleCheck className="size-4" />
                          Succeeded
                        </span>
                      )}
                      {j.status === "failed" && (
                        <span className="inline-flex items-center gap-1.5 text-destructive">
                          <CircleX className="size-4" />
                          Failed
                        </span>
                      )}
                      {(j.status === "running" || j.status === "queued") && (
                        <Badge variant="secondary">
                          <LoaderCircle className="animate-spin" />
                          {j.status === "running" ? "Running" : "Queued"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {j.started_at ? date(j.started_at, true) : "—"}
                    </TableCell>
                    <TableCell className="max-w-md truncate pr-6 text-muted-foreground" title={j.error ?? j.result ?? ""}>
                      {j.error ?? j.result ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
