import { cache } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { activeJobs, getOpportunity, listOpportunities } from "@lens/core"
import { EvidenceList } from "@/components/evidence-list"
import { JobWatcher } from "@/components/job-watcher"
import { OpportunityHeader } from "@/components/opportunity-header"
import { GateForm, NotesCard, OutcomeForm, SpecPanel } from "@/components/opportunity-panels"
import { OpportunityTabs } from "@/components/opportunity-tabs"
import { StatCard } from "@/components/stat-card"
import { Badge } from "@/components/ui/badge"
import { SIGNAL_LABEL } from "@/lib/opportunities"

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }

const load = cache(async (id: string) => (/^\d+$/.test(id) ? getOpportunity(id) : null))

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const o = await load((await params).id)
  return { title: o?.label || "Opportunity" }
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null)

export default async function OpportunityPage({ params, searchParams }: Params) {
  const { id } = await params
  const sp = await searchParams
  const tab = ["gate", "spec", "outcome"].includes(sp.tab ?? "") ? sp.tab! : "evidence"
  const [opp, active, others] = await Promise.all([load(id), activeJobs(), listOpportunities({ status: "active", own: "all" })])
  if (!opp) notFound()
  const watched = active.filter((j) => j.type === "generate_spec")
  const sig = opp.signals
  const signalTotal = sig.paying_competitor + sig.churned + sig.workaround + sig.stated_wtp

  let body: React.ReactNode
  if (tab === "gate") body = <GateForm key={iso(opp.updated_at)} id={opp.id} gate={opp.gate} />
  else if (tab === "spec")
    body = <SpecPanel id={opp.id} label={opp.label} spec={opp.spec_md} generatedAt={iso(opp.spec_generated_at)} busy={watched.length > 0} />
  else if (tab === "outcome") body = <OutcomeForm key={iso(opp.updated_at)} id={opp.id} outcome={opp.outcome} />
  else body = <EvidenceList rows={opp.evidence.map((e) => ({ ...e, date: iso(e.date) }))} />

  return (
    <>
      <OpportunityHeader
        opp={{
          id: opp.id,
          label: opp.label,
          kind: opp.kind,
          status: opp.status,
          killed_reason: opp.killed_reason,
          revisit_after: iso(opp.revisit_after),
        }}
        mergeTargets={others.filter((o) => o.id !== opp.id).map((o) => ({ id: o.id, label: o.label }))}
      />
      <JobWatcher initial={watched.map((j) => ({ ...j, run_after: new Date(j.run_after).toISOString() }))} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <StatCard label="Score" value={opp.score.toFixed(1)} />
        <StatCard label="Evidence" value={opp.n} hint={`${opp.recent.toFixed(1)} recency-weighted`} />
        <StatCard label="Listings" value={opp.listings} />
        <StatCard label="Avg pain" value={opp.avg_pain.toFixed(1)} hint="Out of 5" />
        <StatCard
          label="Signals"
          value={signalTotal}
          hint={
            (Object.entries(sig) as [string, number][])
              .filter(([, c]) => c > 0)
              .map(([k, c]) => `${c} ${(SIGNAL_LABEL[k] ?? k).toLowerCase()}`)
              .join(" · ") || "No willingness-to-pay signals"
          }
        />
      </div>
      {opp.competitors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Competitors</span>
          {opp.competitors.map((c) => (
            <Badge key={c.name} variant="outline">
              {c.name} <span className="tabular-nums opacity-60">{c.count}</span>
            </Badge>
          ))}
        </div>
      )}
      <NotesCard key={iso(opp.updated_at)} id={opp.id} notes={opp.notes} />
      <OpportunityTabs tab={tab} evidenceCount={opp.evidence.length}>
        {body}
      </OpportunityTabs>
    </>
  )
}
