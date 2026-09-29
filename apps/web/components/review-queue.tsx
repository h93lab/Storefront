"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, X } from "lucide-react"
import { toast } from "sonner"
import { recordVerdictAction } from "@/app/actions"
import { AppIcon } from "@/components/app-icon"
import { type EvidenceRow, Highlighted } from "@/components/evidence-list"
import { useUrlState } from "@/components/library-filters"
import { Stars } from "@/components/reviews-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { date, storeLabel } from "@/lib/format"
import { SIGNAL_LABEL } from "@/lib/opportunities"
import type { VerdictCorrection } from "@lens/core"

const KEEP = "keep"
const KINDS = ["complaint", "request", "praise", "other"] as const

function ReviewCard({ row, onDone }: { row: EvidenceRow; onDone: () => void }) {
  const [wrong, setWrong] = React.useState(false)
  const [signal, setSignal] = React.useState(KEEP)
  const [kind, setKind] = React.useState(KEEP)
  const [pain, setPain] = React.useState(KEEP)
  const [label, setLabel] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [pending, start] = React.useTransition()

  const submit = (verdict: "correct" | "wrong") =>
    start(async () => {
      const corrected: VerdictCorrection = {}
      if (verdict === "wrong") {
        if (signal !== KEEP) corrected.wtp_signal = signal as VerdictCorrection["wtp_signal"]
        if (kind !== KEEP) corrected.label_kind = kind as VerdictCorrection["label_kind"]
        if (pain !== KEEP) corrected.pain_score = Number(pain)
        if (label.trim()) corrected.label = label.trim()
      }
      const r = await recordVerdictAction({
        source: row.source,
        ref: row.ref,
        verdict,
        corrected: Object.keys(corrected).length ? corrected : null,
        notes: verdict === "wrong" ? notes || null : null,
      })
      if (r.ok) onDone()
      else toast.error(r.error)
    })

  const id = `rv-${row.source}-${row.ref}`
  return (
    <article className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon name={row.app_name ?? "Imported"} path={row.app_icon} className="size-7" />
          <span className="truncate font-medium">{row.app_name ?? "Imported text"}</span>
          {row.store && <span className="text-xs text-muted-foreground">{storeLabel(row.store)}</span>}
          {row.rating != null && <Stars rating={row.rating} />}
        </div>
        <span className="text-xs text-muted-foreground">{row.date ? date(row.date) : "Undated"}</span>
      </div>
      {row.title && <p className="text-sm font-medium">{row.title}</p>}
      {row.body && (
        <p className="max-w-prose text-sm whitespace-pre-line text-muted-foreground" dir="auto">
          <Highlighted text={row.body} span={row.evidence_span} />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-xs text-muted-foreground">Model says</span>
        {row.label && <Badge variant="secondary">{row.label}</Badge>}
        {row.label_kind && (
          <Badge variant="outline" className="capitalize">
            {row.label_kind}
          </Badge>
        )}
        <Badge variant="secondary" className={row.wtp_signal && row.wtp_signal !== "none" ? "bg-warning/15 text-warning" : undefined}>
          {row.wtp_signal && SIGNAL_LABEL[row.wtp_signal] ? SIGNAL_LABEL[row.wtp_signal] : "No signal"}
        </Badge>
        {row.pain_score != null && (
          <Badge variant="outline" className="tabular-nums">
            Pain {row.pain_score}/5
          </Badge>
        )}
      </div>
      {wrong ? (
        <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Correct only what is wrong; the rest stays as the model said.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-signal`}>Signal</Label>
              <Select value={signal} onValueChange={setSignal}>
                <SelectTrigger id={`${id}-signal`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep</SelectItem>
                  {Object.entries(SIGNAL_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                  <SelectItem value="none">No signal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-kind`}>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id={`${id}-kind`} className="w-full capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep</SelectItem>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k} className="capitalize">
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-pain`}>Pain</Label>
              <Select value={pain} onValueChange={setPain}>
                <SelectTrigger id={`${id}-pain`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>Keep</SelectItem>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-label`}>Label</Label>
            <Input
              id={`${id}-label`}
              maxLength={80}
              placeholder="Leave empty to keep"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-notes`}>Notes</Label>
            <Textarea id={`${id}-notes`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => submit("wrong")}>
              {pending && <Spinner />}
              Save verdict
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setWrong(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => submit("correct")}>
            {pending ? <Spinner /> : <Check />}
            Correct
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setWrong(true)}>
            <X />
            Wrong
          </Button>
        </div>
      )}
    </article>
  )
}

export function ReviewQueue({ rows, onlySignals }: { rows: EvidenceRow[]; onlySignals: boolean }) {
  const router = useRouter()
  const { set, pending } = useUrlState()
  const [left, setLeft] = React.useState(rows)
  const done = (ref: string) => {
    const next = left.filter((r) => r.ref !== ref)
    setLeft(next)
    // Refresh once the batch is finished so the tiles and the next batch load.
    if (next.length === 0) router.refresh()
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch id="only-signals" checked={onlySignals} onCheckedChange={(v) => set({ signals: v ? "1" : null })} />
          <Label htmlFor="only-signals">Only items with signals</Label>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">{left.length} left in this batch</span>
      </div>
      <div
        aria-busy={pending}
        className={pending ? "pointer-events-none grid gap-3 opacity-50 transition-opacity" : "grid gap-3 transition-opacity"}
      >
        {left.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Nothing to review</EmptyTitle>
              <EmptyDescription>
                {onlySignals
                  ? "No unjudged items with a signal from the current analyser. Turn the filter off to review the rest."
                  : "Every item classified by the current analyser has a verdict, or nothing has been analysed yet."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          left.map((r) => <ReviewCard key={`${r.source}:${r.ref}`} row={r} onDone={() => done(r.ref)} />)
        )}
      </div>
    </div>
  )
}
