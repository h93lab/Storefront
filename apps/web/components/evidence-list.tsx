"use client"

import * as React from "react"
import { AppIcon } from "@/components/app-icon"
import { Stars } from "@/components/reviews-panel"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { date, storeLabel } from "@/lib/format"
import { SIGNAL_LABEL } from "@/lib/opportunities"
import type { Evidence } from "@lens/core"

export type EvidenceRow = Omit<Evidence, "date"> & { date: string | null }

export function Highlighted({ text, span }: { text: string; span: string | null }) {
  const needle = span?.trim()
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1
  if (!needle || at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-warning/30 px-0.5 text-foreground">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}

export function EvidenceList({ rows }: { rows: EvidenceRow[] }) {
  const [signal, setSignal] = React.useState("all")
  const [minPain, setMinPain] = React.useState("0")
  const shown = rows.filter((r) => {
    if (signal === "any" && !(r.wtp_signal && r.wtp_signal !== "none")) return false
    if (signal !== "all" && signal !== "any" && r.wtp_signal !== signal) return false
    return (r.pain_score ?? 0) >= Number(minPain)
  })
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={signal} onValueChange={setSignal}>
          <SelectTrigger className="w-52" aria-label="Signal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All evidence</SelectItem>
            <SelectItem value="any">Any WTP signal</SelectItem>
            {Object.entries(SIGNAL_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={minPain} onValueChange={setMinPain}>
          <SelectTrigger className="w-40" aria-label="Minimum pain">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n === 0 ? "Any pain" : `Pain ≥ ${n}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground tabular-nums">
          {shown.length} of {rows.length}
        </span>
      </div>
      <div className="divide-y rounded-xl border bg-card">
        {shown.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No evidence matches these filters.</p>}
        {shown.map((r) => (
          <article key={`${r.source}:${r.ref}`} className="grid gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <AppIcon name={r.app_name ?? "Imported"} path={r.app_icon} className="size-7" />
                <span className="truncate font-medium">{r.app_name ?? "Imported text"}</span>
                {r.store && (
                  <span className="text-xs text-muted-foreground">
                    {storeLabel(r.store)}
                    {r.country ? ` · ${r.country.toUpperCase()}` : ""}
                  </span>
                )}
                {r.rating != null && <Stars rating={r.rating} />}
              </div>
              <span className="text-xs text-muted-foreground">{r.date ? date(r.date) : "Undated"}</span>
            </div>
            {r.title && <p className="text-sm font-medium">{r.title}</p>}
            {r.body && (
              <p className="max-w-prose text-sm whitespace-pre-line text-muted-foreground" dir="auto">
                <Highlighted text={r.body} span={r.evidence_span} />
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {r.wtp_signal && SIGNAL_LABEL[r.wtp_signal] && (
                <Badge variant="secondary" className="bg-warning/15 text-warning" title={r.workaround ?? undefined}>
                  {SIGNAL_LABEL[r.wtp_signal]}
                </Badge>
              )}
              {r.competitor_mentioned && <Badge variant="outline">Competitor: {r.competitor_mentioned}</Badge>}
              {r.pain_score != null && (
                <Badge variant="outline" className="tabular-nums">
                  Pain {r.pain_score}/5
                </Badge>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
