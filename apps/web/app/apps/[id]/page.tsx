import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { AlertTriangle, ExternalLink, GitCompare, Lightbulb, LoaderCircle, Star, TrendingDown, TrendingUp } from "lucide-react"
import {
  getApp,
  getChanges,
  getInsights,
  getReviews,
  getScreenshots,
  getScreenshotsByHashes,
  getSettings,
  pendingJobsFor,
  ratingBreakdown,
  ratingHistory,
  topicCounts,
  unanalysedCount,
  type RatingFilter,
  type Screenshot,
} from "@lens/core"
import { AnalyseButton } from "@/components/analyse-button"
import { AppIcon } from "@/components/app-icon"
import { AppTabs } from "@/components/app-tabs"
import { AutoRefresh } from "@/components/auto-refresh"
import { ChangesTimeline } from "@/components/changes-timeline"
import { RatingChart } from "@/components/charts"
import { ReviewsPanel } from "@/components/reviews-panel"
import { ScreenshotGallery } from "@/components/screenshot-gallery"
import { StatCard } from "@/components/stat-card"
import { SyncButton } from "@/components/sync-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { boardOptions } from "@/lib/boards"
import { ago, bytes, compact, COUNTRIES, date, LANGUAGES, storeLabel } from "@/lib/format"

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const app = await getApp((await params).id)
  return { title: app?.name || "App" }
}

export default async function AppPage({ params, searchParams }: Params) {
  const { id } = await params
  const sp = await searchParams
  const app = await getApp(id)
  if (!app) notFound()
  const tab = ["screenshots", "reviews", "insights", "changes"].includes(sp.tab ?? "") ? sp.tab! : "overview"
  const [jobs, changes] = await Promise.all([pendingJobsFor(id), getChanges({ appId: id })])
  const syncing = app.status === "pending" || app.status === "syncing" || jobs.some((j) => j.type === "sync_app")
  const analysing = jobs.some((j) => j.type === "analyse_app")
  const name = app.name || app.store_id
  const country = COUNTRIES.find(([c]) => c === app.country)?.[1] ?? app.country.toUpperCase()

  let body: React.ReactNode = null

  if (app.status === "pending") {
    body = (
      <div className="grid gap-4">
        <Alert>
          <LoaderCircle className="animate-spin" />
          <AlertTitle>
            Fetching {app.store_id} from {storeLabel(app.store)}
          </AlertTitle>
          <AlertDescription>Listing, screenshots and reviews usually take under a minute. This page updates on its own.</AlertDescription>
        </Alert>
        <div className="grid gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  } else if (tab === "overview") {
    const [history, breakdown] = await Promise.all([ratingHistory(id, 90), ratingBreakdown(id)])
    const first = history.find((h) => h.rating != null)?.rating
    const last = [...history].reverse().find((h) => h.rating != null)?.rating
    const trend = first != null && last != null ? last - first : null
    const maxCount = Math.max(1, ...breakdown.map((b) => b.count))
    body = (
      <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Rating"
            value={app.rating != null ? app.rating.toFixed(2) : "—"}
            hint={`${compact(app.ratings_count)} ratings`}
          />
          <StatCard label="Reviews stored" value={app.reviews_count.toLocaleString()} hint="Newest from the store" />
          <StatCard
            label="Version"
            value={app.version ?? "—"}
            hint={app.updated_at_store ? `Updated ${date(app.updated_at_store)}` : undefined}
          />
          <StatCard label="Price" value={app.price ?? "—"} hint={bytes(app.size_bytes)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Average rating</CardTitle>
              <CardDescription>Recorded at each sync · last 90 days</CardDescription>
              {trend != null && history.length > 1 && (
                <CardAction>
                  <Badge variant="secondary" className={trend >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}>
                    {trend >= 0 ? <TrendingUp /> : <TrendingDown />}
                    {trend >= 0 ? "+" : ""}
                    {trend.toFixed(2)}
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {history.filter((h) => h.rating != null).length > 1 ? (
                <RatingChart data={history} />
              ) : (
                <p className="text-sm text-muted-foreground">The chart fills in as daily syncs record the rating.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Stored reviews by rating</CardTitle>
              <CardDescription>{app.reviews_count.toLocaleString()} reviews</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {[5, 4, 3, 2, 1].map((r) => {
                const n = breakdown.find((b) => b.rating === r)?.count ?? 0
                return (
                  <Link
                    key={r}
                    href={`/apps/${id}?tab=reviews&rating=${r >= 4 ? "pos" : r === 3 ? "neu" : "neg"}`}
                    className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-3 text-sm hover:opacity-80"
                  >
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      {r}
                      <Star className="size-3 fill-star text-star" />
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-star" style={{ width: `${(n / maxCount) * 100}%` }} />
                    </span>
                    <span className="text-right text-muted-foreground tabular-nums">{n}</span>
                  </Link>
                )
              })}
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Store description</CardTitle>
              <CardDescription>
                As published on {storeLabel(app.store)} ({country})
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="max-w-prose text-sm leading-relaxed whitespace-pre-line" dir="auto">
                {app.description || "No description."}
              </p>
              {app.release_notes && (
                <div className="grid gap-1 rounded-lg bg-muted/60 p-3">
                  <span className="text-xs font-medium text-muted-foreground">What&apos;s new in {app.version}</span>
                  <p className="text-sm whitespace-pre-line" dir="auto">
                    {app.release_notes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                {[
                  ["Developer", app.developer],
                  ["Category", app.category],
                  ["Store", storeLabel(app.store)],
                  [
                    "Store id",
                    <span key="sid" className="font-mono text-xs break-all">
                      {app.store_id}
                    </span>,
                  ],
                  ["Country", country],
                  ["Review language", LANGUAGES.find(([c]) => c === app.lang)?.[1] ?? app.lang],
                  ["Size", bytes(app.size_bytes)],
                  ["Content rating", app.content_rating],
                  ["Added", date(app.created_at)],
                  ["Last sync", ago(app.last_synced_at)],
                ].map(([k, v]) => (
                  <div key={String(k)} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right">{v ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </>
    )
  } else if (tab === "screenshots") {
    const [shots, boards] = await Promise.all([getScreenshots(id, { includeInactive: sp.all === "1" }), boardOptions()])
    // Screens added by a screenshot change in the last 7 days get a "new" badge.
    const newest = changes.find((c) => c.field === "screenshots" && Date.now() - new Date(c.detected_at).getTime() < 7 * 864e5)
    const before = new Set((newest?.old_value as string[] | null) ?? [])
    const added = ((newest?.new_value as string[] | null) ?? []).filter((h) => !before.has(h))
    const newPaths = new Set((await getScreenshotsByHashes(id, added)).map((s) => s.path))
    const phone = shots.filter((s) => s.device === "phone")
    const tablet = shots.filter((s) => s.device !== "phone")
    const toGallery = (list: Screenshot[]) =>
      list.map((s) => ({ id: s.id, path: s.path, label: `Screen ${s.position + 1}`, isNew: newPaths.has(s.path), active: s.active }))
    body = shots.length ? (
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {phone.filter((s) => s.active).length} phone{tablet.length ? ` · ${tablet.filter((s) => s.active).length} tablet` : ""}{" "}
            screenshots · stored on your server as WebP
          </p>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/apps/${id}?tab=screenshots${sp.all === "1" ? "" : "&all=1"}`}>
              {sp.all === "1" ? "Hide removed screenshots" : "Show removed screenshots"}
            </Link>
          </Button>
        </div>
        <ScreenshotGallery shots={toGallery(phone)} appName={name} boards={boards} />
        {tablet.length > 0 && (
          <div className="grid gap-3">
            <h2 className="text-sm font-medium">Tablet</h2>
            <ScreenshotGallery
              shots={toGallery(tablet)}
              appName={name}
              boards={boards}
              columns="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            />
          </div>
        )}
      </div>
    ) : (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No screenshots stored</EmptyTitle>
          <EmptyDescription>
            {app.status === "error"
              ? "The last sync failed. Check the error above and sync again."
              : "The store listing had no screenshots, or the download failed."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else if (tab === "reviews") {
    const limit = Math.min(Number(sp.limit) || 50, 500)
    const rating = (["pos", "neu", "neg"].includes(sp.rating ?? "") ? sp.rating : "all") as RatingFilter
    const sort = sp.sort === "low" || sp.sort === "high" ? sp.sort : "new"
    const [{ rows, total }, topics, boards] = await Promise.all([
      getReviews(id, { rating, q: sp.q, topic: sp.topic, sort, limit }),
      topicCounts(id),
      boardOptions(),
    ])
    body = (
      <ReviewsPanel
        appId={id}
        appName={name}
        rows={rows.map((r) => ({ ...r, reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null }))}
        total={total}
        topics={topics}
        boards={boards}
        limit={limit}
      />
    )
  } else if (tab === "insights") {
    const [ins, settings, pending] = await Promise.all([getInsights(id), getSettings(), unanalysedCount(id)])
    const configured = Boolean(settings.ai.baseUrl && settings.ai.model)
    if (!ins) {
      body = (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{configured ? "No analysis yet" : "Connect an AI provider"}</EmptyTitle>
            <EmptyDescription>
              {configured
                ? `Run the analysis to classify ${pending.toLocaleString()} reviews into sentiment, topics, complaints and feature requests.`
                : "Add any OpenAI-compatible endpoint in Settings. Reviews are then analysed automatically after each sync."}
            </EmptyDescription>
          </EmptyHeader>
          {configured ? (
            <AnalyseButton appId={id} busy={analysing} label="Analyse reviews" />
          ) : (
            <Button asChild>
              <Link href="/settings">Open settings</Link>
            </Button>
          )}
        </Empty>
      )
    } else {
      const s = ins.sentiment
      const total = s.positive + s.neutral + s.negative || 1
      const pct = (n: number) => Math.round((n / total) * 100)
      const bars = (rows: { label: string; count: number }[], color: string) => {
        const max = Math.max(1, ...rows.map((r) => r.count))
        return rows.length ? (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_minmax(4rem,7rem)_2.5rem] items-center gap-3 py-2.5 text-sm">
                <span className="first-letter:uppercase">{r.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: color }} />
                </span>
                <span className="text-right text-muted-foreground tabular-nums">{r.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None found in these reviews.</p>
        )
      }
      body = (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Sentiment</CardTitle>
              <CardDescription>
                Latest {ins.reviews_count.toLocaleString()} reviews · analysed {ago(ins.generated_at)}
                {ins.model ? ` with ${ins.model}` : ""}
                {pending ? ` · ${pending} new reviews not analysed yet` : ""}
              </CardDescription>
              <CardAction>
                <AnalyseButton appId={id} busy={analysing} />
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div
                className="flex h-3 gap-0.5 overflow-hidden rounded-full"
                role="img"
                aria-label={`${pct(s.positive)}% positive, ${pct(s.neutral)}% neutral, ${pct(s.negative)}% negative`}
              >
                <div className="bg-success" style={{ width: `${pct(s.positive)}%` }} />
                <div className="bg-muted-foreground/60" style={{ width: `${pct(s.neutral)}%` }} />
                <div className="bg-destructive" style={{ width: `${pct(s.negative)}%` }} />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-success" />
                  Positive {pct(s.positive)}%
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-muted-foreground/60" />
                  Neutral {pct(s.neutral)}%
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-destructive" />
                  Negative {pct(s.negative)}%
                </span>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-4" />
                  Top complaints
                </CardTitle>
                <CardDescription>Mentions across analysed reviews</CardDescription>
              </CardHeader>
              <CardContent>{bars(ins.complaints, "var(--destructive)")}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="size-4" />
                  Feature requests
                </CardTitle>
                <CardDescription>What users ask for</CardDescription>
              </CardHeader>
              <CardContent>{bars(ins.requests, "var(--chart-2)")}</CardContent>
            </Card>
          </div>
          {ins.summary && (
            <Card>
              <CardHeader>
                <CardTitle>Opportunities for your project</CardTitle>
                <CardDescription>Generated from the complaints and requests above</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="max-w-prose text-sm leading-relaxed">{ins.summary}</p>
              </CardContent>
            </Card>
          )}
        </>
      )
    }
  } else if (tab === "changes") {
    body = (
      <Card>
        <CardHeader>
          <CardTitle>Change history</CardTitle>
          <CardDescription>Each sync compares the listing with the previous snapshot</CardDescription>
        </CardHeader>
        <CardContent>
          {changes.length ? (
            <ChangesTimeline changes={changes} />
          ) : (
            <p className="text-sm text-muted-foreground">No changes since this app was added on {date(app.created_at)}.</p>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <AutoRefresh active={syncing || analysing} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <AppIcon name={name} path={app.icon_path} className="size-16 text-2xl sm:size-18" />
          <div className="grid min-w-0 flex-1 gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="text-muted-foreground">
              {app.developer ?? "—"}
              {app.category ? ` · ${app.category}` : ""}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{storeLabel(app.store)}</Badge>
              <Badge variant="secondary">{app.country.toUpperCase()}</Badge>
              {app.rating != null && (
                <Badge variant="outline" className="tabular-nums">
                  <Star className="fill-star text-star" />
                  {app.rating.toFixed(1)}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/compare?ids=${id}`}>
              <GitCompare />
              Compare
            </Link>
          </Button>
          <SyncButton appId={id} busy={syncing} />
          {app.store_url && (
            <Button variant="secondary" size="sm" asChild>
              <a href={app.store_url} target="_blank" rel="noreferrer">
                <ExternalLink />
                Store
              </a>
            </Button>
          )}
        </div>
      </div>
      {app.status === "error" && app.last_error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Last sync failed</AlertTitle>
          <AlertDescription>{app.last_error}</AlertDescription>
        </Alert>
      )}
      <AppTabs tab={tab} counts={{ reviews: app.reviews_count, screenshots: app.screenshots_count, changes: changes.length }} />
      {body}
    </>
  )
}
