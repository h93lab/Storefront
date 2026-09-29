import type { Metadata } from "next"
import Link from "next/link"
import { activeJobs, listOpportunities, validationDecision, type OpportunityKind, type OpportunityStatus } from "@lens/core"
import { GroupLabelsButton } from "@/components/group-labels-button"
import { JobWatcher } from "@/components/job-watcher"
import { OpportunityFilters } from "@/components/opportunity-filters"
import { DecisionBadge } from "@/components/opportunity-panels"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ago } from "@/lib/format"
import { SIGNAL_LABEL, STATUS_CLASS } from "@/lib/opportunities"

export const metadata: Metadata = { title: "Opportunities" }

const STATUS_VALUES = ["active", "surfaced", "validating", "building", "shipped", "killed", "all"]

const per100 = (n: number, installs: number) => (installs ? ((n / installs) * 100).toFixed(1) : "—")

async function Outcomes() {
  const [shipped, killed] = await Promise.all([
    listOpportunities({ status: "shipped", own: "all", sort: "score" }),
    listOpportunities({ status: "killed", own: "all", sort: "score" }),
  ])
  const rows = [...shipped, ...killed]
  const decisionOf = (id: number) => validationDecision(rows.find((r) => r.id === id)?.validation_metrics ?? null)
  if (rows.length === 0)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No outcomes yet</EmptyTitle>
          <EmptyDescription>
            Shipped and killed opportunities appear here with their score, gate result, validation decision and launch numbers, so you can
            see whether the score predicts anything.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Opportunity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Gate</TableHead>
            <TableHead>Validation</TableHead>
            <TableHead className="text-right">Installs</TableHead>
            <TableHead className="text-right">Trial rate</TableHead>
            <TableHead className="text-right">Paying / 100</TableHead>
            <TableHead>Killed reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((o) => {
            const passed = o.gate ? Object.values(o.gate.checks).filter(Boolean).length : null
            const out = o.outcome
            return (
              <TableRow key={o.id}>
                <TableCell className="max-w-xs font-medium whitespace-normal">
                  <Link href={`/opportunities/${o.id}`} className="hover:underline">
                    {o.label}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={`capitalize ${STATUS_CLASS[o.status] ?? ""}`}>
                    {o.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{o.score.toFixed(1)}</TableCell>
                <TableCell className="text-right tabular-nums">{passed == null ? "—" : `${passed}/8`}</TableCell>
                <TableCell>
                  <DecisionBadge decision={decisionOf(o.id)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{out ? out.installs : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {out && out.installs ? `${per100(out.trial_starts, out.installs)}%` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{out ? per100(out.paying, out.installs) : "—"}</TableCell>
                <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                  {o.status === "killed" ? (o.killed_reason ?? "—") : ""}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const outcomes = sp.view === "outcomes"
  const status = (STATUS_VALUES.includes(sp.status ?? "") ? sp.status : "active") as OpportunityStatus | "active" | "all"
  const kind = sp.kind === "complaint" || sp.kind === "request" ? (sp.kind as OpportunityKind) : undefined
  const own = sp.own === "only" ? "only" : "exclude"
  const [rows, active] = await Promise.all([
    listOpportunities({ status, kind, own, q: sp.q?.trim() || undefined, sort: "score" }),
    activeJobs(),
  ])
  const watched = active.filter((j) => ["group_labels", "analyse_items", "analyse_app", "analyse_all"].includes(j.type))
  const grouping = active.some((j) => j.type === "group_labels")
  const filtered = Boolean(sp.q || sp.kind || sp.status || own === "only")

  return (
    <>
      <JobWatcher initial={watched.map((j) => ({ ...j, run_after: new Date(j.run_after).toISOString() }))} />
      <PageHeader
        title="Opportunities"
        description="Recurring complaints and requests found in reviews and imported text, ranked by score."
      >
        <Button variant={outcomes ? "outline" : "secondary"} size="sm" asChild>
          <Link href="/opportunities">Ranked</Link>
        </Button>
        <Button variant={outcomes ? "secondary" : "outline"} size="sm" asChild>
          <Link href="/opportunities?view=outcomes">Outcomes</Link>
        </Button>
        <GroupLabelsButton busy={grouping} />
      </PageHeader>
      {outcomes ? (
        <Outcomes />
      ) : (
        <OpportunityFilters>
          {rows.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>{filtered ? "No opportunities match these filters" : "No opportunities yet"}</EmptyTitle>
                <EmptyDescription>
                  {filtered
                    ? "Try another status or clear the filters."
                    : "Labels are grouped into opportunities after reviews and imported items have been analysed. Analyse an app, then press “Group new labels”."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">n</TableHead>
                    <TableHead className="text-right">Listings</TableHead>
                    <TableHead className="text-right">Avg pain</TableHead>
                    <TableHead>Signals</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="max-w-xs font-medium whitespace-normal">
                        <Link href={`/opportunities/${o.id}`} className="hover:underline">
                          {o.label}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {o.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{o.score.toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.n}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.listings}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.avg_pain.toFixed(1)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(Object.entries(o.signals) as [string, number][])
                            .filter(([, c]) => c > 0)
                            .map(([k, c]) => (
                              <Badge key={k} variant="secondary" className="bg-warning/15 text-warning">
                                {SIGNAL_LABEL[k] ?? k} <span className="tabular-nums">{c}</span>
                              </Badge>
                            ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{ago(o.last_seen)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={`capitalize ${STATUS_CLASS[o.status] ?? ""}`}>
                          {o.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </OpportunityFilters>
      )}
    </>
  )
}
