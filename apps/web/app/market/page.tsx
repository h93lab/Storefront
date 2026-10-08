import type { Metadata } from "next"
import Link from "next/link"
import { activeJobs, appllamaConnected, appllamaCredits, getSettings, listSavedMarket, type AppllamaCredits } from "@lens/core"
import { JobWatcher } from "@/components/job-watcher"
import { MarketSearch } from "@/components/market-search"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { ago, compact } from "@/lib/format"
import { usd } from "@/lib/market"

export const metadata: Metadata = { title: "Market" }
export const dynamic = "force-dynamic"

export default async function MarketPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const settings = await getSettings()
  if (!appllamaConnected(settings)) {
    return (
      <>
        <PageHeader
          title="Market"
          description="Revenue, downloads, prices and every screen of top apps, from your Appllama subscription."
        />
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Connect Appllama first</EmptyTitle>
            <EmptyDescription>Sign in once with your Appllama Pro account. There is no API key to copy.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <a href="/api/appllama/connect">Connect Appllama</a>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    )
  }
  let credits: AppllamaCredits | null = null
  let creditsError: string | null = null
  const [creditsR, saved, active] = await Promise.all([
    appllamaCredits().then(
      (c) => ({ c }),
      (e: unknown) => ({ e: e instanceof Error ? e.message : String(e) }),
    ),
    listSavedMarket(),
    activeJobs(),
  ])
  if ("c" in creditsR) credits = creditsR.c
  else creditsError = creditsR.e
  const watched = active
    .filter((j) => (j.type as string) === "market_save" || (j.type as string) === "market_refresh")
    .map((j) => ({ ...j, run_after: new Date(j.run_after).toISOString() }))
  const total = credits ? credits.monthly_credits + credits.bonus_credits : 0
  const savedMap = Object.fromEntries(saved.map((s) => [s.appllama_id, s.app_id]))

  return (
    <>
      <PageHeader
        title="Market"
        description="Search Appllama, then save the specific apps you want to study. Screens are stored on your server."
      />
      <JobWatcher initial={watched} />
      <Card className="gap-2 py-4">
        <CardContent className="grid gap-2 px-4 sm:px-5">
          {credits ? (
            <>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="tabular-nums">
                  <strong>{credits.remaining.toLocaleString()}</strong> of {total.toLocaleString()} credits left this month
                </span>
                <span className="text-muted-foreground">
                  {credits.limits.per_minute}/min · {credits.limits.per_day}/day
                </span>
              </div>
              <Progress value={total ? (credits.remaining / total) * 100 : 0} aria-label="Credits remaining" />
            </>
          ) : (
            <p className="text-sm text-destructive">Could not read your credits: {creditsError}</p>
          )}
        </CardContent>
      </Card>
      <MarketSearch savedMap={savedMap} initialQuery={sp.q ?? ""} />
      {saved.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Saved</CardTitle>
            <CardDescription>{saved.length} apps with market data</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {saved.map((s) => (
              <Link
                key={s.app_id}
                href={`/apps/${s.app_id}?tab=market`}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:opacity-80"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {s.revenue_monthly_usd != null ? `${usd(s.revenue_monthly_usd)}/mo · ` : ""}
                  {compact(s.downloads)} downloads · {s.screens_synced}/{s.screens_count ?? "?"} screens · {ago(s.fetched_at)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  )
}
