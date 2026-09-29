"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Download, Sparkles } from "lucide-react"
import { toast } from "sonner"
import {
  generateSpecAction,
  generateValidationAction,
  recordOutcomeAction,
  saveGateAction,
  saveValidationMetricsAction,
  updateOpportunityAction,
} from "@/app/actions"
import { CopyButton } from "@/components/copy-button"
import { SimpleMarkdown } from "@/components/simple-markdown"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ago } from "@/lib/format"

/** Runs a server action, toasts the outcome and refreshes the page data. */
function useSave() {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const save = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn()
      if (r.ok) toast.success(r.message ?? "Saved")
      else toast.error(r.error)
      router.refresh()
    })
  return { pending, save }
}

export function NotesCard({ id, notes }: { id: number; notes: string | null }) {
  const [value, setValue] = React.useState(notes ?? "")
  const { pending, save } = useSave()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea aria-label="Notes" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ideas, links, decisions…" />
        <Button
          className="justify-self-start"
          size="sm"
          disabled={pending || value === (notes ?? "")}
          onClick={() => save(() => updateOpportunityAction(id, { notes: value }))}
        >
          {pending && <Spinner />}
          Save notes
        </Button>
      </CardContent>
    </Card>
  )
}

const GATE: { key: string; label: string }[] = [
  { key: "scope", label: "Solo-dev scope: ≤4 weeks, ≤6 screens, ≤3 tables, no native modules" },
  { key: "permissions", label: "Works within iOS/Android foreground limits; no closed APIs or scraping" },
  { key: "single_player", label: "Valuable to user #1 alone (no marketplace/social)" },
  { key: "monetization", label: "One clear paid model; users already pay a competitor or a workaround" },
  { key: "demand", label: "Competitor ≥1k ratings and ≤3.8★, or ≥15 independent complaints from 2+ sources in 90 days" },
  { key: "distribution", label: "The threads/subreddits/keyword where the pain lives allow launching there" },
  { key: "data_legal", label: "No sensitive PII (medical, financial credentials, minors), no copyrighted ingestion" },
  { key: "founder_fit", label: "You can use it daily yourself" },
]
const PERMANENT = ["permissions", "single_player", "data_legal"]

export function GateForm({
  id,
  gate,
}: {
  id: number
  gate: { checks: Record<string, boolean>; notes?: string; checked_at?: string } | null
}) {
  const [checks, setChecks] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(GATE.map((g) => [g.key, Boolean(gate?.checks?.[g.key])])),
  )
  const [notes, setNotes] = React.useState(gate?.notes ?? "")
  const { pending, save } = useSave()
  const passed = GATE.filter((g) => checks[g.key]).length
  const permanentFail = PERMANENT.filter((k) => gate && !checks[k])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Build gate</CardTitle>
        <CardDescription>
          <span className="tabular-nums">{passed}/8 pass</span>
          {gate?.checked_at ? ` · saved ${ago(gate.checked_at)}` : " · not saved yet"}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Alert>
          <AlertTitle>Some failures are permanent</AlertTitle>
          <AlertDescription>
            Failing permissions, single-player value or data/legal cannot be fixed later by building more. Treat a fail there as a kill.
          </AlertDescription>
        </Alert>
        {permanentFail.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Permanent fail</AlertTitle>
            <AlertDescription>{permanentFail.map((k) => GATE.find((g) => g.key === k)!.label).join(" · ")}</AlertDescription>
          </Alert>
        )}
        <div className="divide-y rounded-lg border">
          {GATE.map((g) => (
            <div key={g.key} className="flex items-center justify-between gap-4 p-3">
              <Label htmlFor={`gate-${g.key}`} className="leading-snug font-normal">
                {g.label}
              </Label>
              <div className="flex shrink-0 items-center gap-2">
                <span className="w-10 text-right text-xs font-medium tabular-nums">{checks[g.key] ? "PASS" : "FAIL"}</span>
                <Switch id={`gate-${g.key}`} checked={checks[g.key]} onCheckedChange={(v) => setChecks((c) => ({ ...c, [g.key]: v }))} />
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="gate-notes">Notes</Label>
          <Textarea id="gate-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Button className="justify-self-start" disabled={pending} onClick={() => save(() => saveGateAction(id, { checks, notes }))}>
          {pending && <Spinner />}
          Save gate
        </Button>
      </CardContent>
    </Card>
  )
}

export function SpecPanel({
  id,
  label,
  spec,
  generatedAt,
  busy,
}: {
  id: number
  label: string
  spec: string | null
  generatedAt: string | null
  busy: boolean
}) {
  const { pending, save } = useSave()
  const download = () => {
    const url = URL.createObjectURL(new Blob([spec ?? ""], { type: "text/markdown" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "spec"
    }.md`
    a.click()
    URL.revokeObjectURL(url)
  }
  const generate = (
    <Button size="sm" variant={spec ? "outline" : "default"} disabled={pending || busy} onClick={() => save(() => generateSpecAction(id))}>
      {pending || busy ? <Spinner /> : <Sparkles />}
      {busy ? "Generating…" : spec ? "Regenerate spec" : "Generate spec"}
    </Button>
  )
  if (!spec)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No spec yet</EmptyTitle>
          <EmptyDescription>
            Generate a build spec from the quotes collected for this opportunity. The worker writes it in the background.
          </EmptyDescription>
        </EmptyHeader>
        {generate}
      </Empty>
    )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spec</CardTitle>
        <CardDescription>{generatedAt ? `Generated ${ago(generatedAt)}` : "Saved spec"}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          {generate}
          <CopyButton value={spec} label="Copy Markdown" />
          <Button variant="outline" size="sm" onClick={download}>
            <Download />
            Download .md
          </Button>
        </div>
        <SimpleMarkdown source={spec} />
      </CardContent>
    </Card>
  )
}

export function OutcomeForm({
  id,
  outcome,
}: {
  id: number
  outcome: { installs: number; trial_starts: number; paying: number; notes: string; recorded_at: string } | null
}) {
  const [installs, setInstalls] = React.useState(String(outcome?.installs ?? 0))
  const [trials, setTrials] = React.useState(String(outcome?.trial_starts ?? 0))
  const [paying, setPaying] = React.useState(String(outcome?.paying ?? 0))
  const [notes, setNotes] = React.useState(outcome?.notes ?? "")
  const { pending, save } = useSave()
  const i = Math.max(0, Number(installs) || 0)
  const trialRate = i ? ((Math.max(0, Number(trials) || 0) / i) * 100).toFixed(1) : "—"
  const per100 = i ? ((Math.max(0, Number(paying) || 0) / i) * 100).toFixed(1) : "—"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Outcome</CardTitle>
        <CardDescription>{outcome ? `Recorded ${ago(outcome.recorded_at)}` : "Record what happened after launch."}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Installs", installs, setInstalls],
            ["Trial starts", trials, setTrials],
            ["Paying", paying, setPaying],
          ].map(([name, value, set]) => (
            <div key={name as string} className="grid gap-2">
              <Label htmlFor={`out-${name}`}>{name as string}</Label>
              <Input
                id={`out-${name}`}
                type="number"
                min={0}
                inputMode="numeric"
                value={value as string}
                onChange={(e) => (set as (v: string) => void)(e.target.value)}
              />
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          Trial start rate {trialRate}
          {i ? "%" : ""} · Paying per 100 installs {per100}
        </p>
        <Alert>
          <AlertTitle>Kill criteria</AlertTitle>
          <AlertDescription>
            At day 60, sunset the app if it has fewer than 100 installs from the launch channel, a trial start rate under 2%, or fewer than
            1 paying user per 100 installs.
          </AlertDescription>
        </Alert>
        <div className="grid gap-2">
          <Label htmlFor="out-notes">Notes</Label>
          <Textarea id="out-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Button
          className="justify-self-start"
          disabled={pending}
          onClick={() =>
            save(() => recordOutcomeAction(id, { installs: Number(installs), trial_starts: Number(trials), paying: Number(paying), notes }))
          }
        >
          {pending && <Spinner />}
          Save outcome
        </Button>
      </CardContent>
    </Card>
  )
}

export interface ValidationKitView {
  headline: string
  subheadline: string
  bullets: string[]
  cta: string
  price: string
  thread_reply: string
  waitlist_copy: string
  generated_at: string
}

export interface ValidationMetricsView {
  waitlist: number
  price_clicks: number
  replies: number
  started_at: string | null
  recorded_at: string
}

const DECISION: Record<string, { label: string; className: string }> = {
  proceed: { label: "Proceed", className: "bg-success/15 text-success" },
  kill: { label: "Kill suggested", className: "bg-destructive/15 text-destructive" },
  pending: { label: "Pending", className: "" },
}

export const DECISION_RULE =
  "Proceed when the waitlist reaches 20, price clicks reach 5 or replies reach 3. Kill is suggested when none of those is met and the test started at least 5 days ago."

export function DecisionBadge({ decision }: { decision: string }) {
  const d = DECISION[decision] ?? DECISION.pending
  return (
    <Badge variant="secondary" className={d.className}>
      {d.label}
    </Badge>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-muted-foreground">{label}</Label>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
      <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-line" dir="auto">
        {value}
      </p>
    </div>
  )
}

export function ValidationPanel({
  id,
  kit,
  metrics,
  decision,
  busy,
}: {
  id: number
  kit: ValidationKitView | null
  metrics: ValidationMetricsView | null
  decision: string
  busy: boolean
}) {
  const { pending, save } = useSave()
  const [waitlist, setWaitlist] = React.useState(String(metrics?.waitlist ?? 0))
  const [clicks, setClicks] = React.useState(String(metrics?.price_clicks ?? 0))
  const [replies, setReplies] = React.useState(String(metrics?.replies ?? 0))
  const [started, setStarted] = React.useState(metrics?.started_at?.slice(0, 10) ?? "")
  const generate = (
    <Button
      size="sm"
      variant={kit ? "outline" : "default"}
      disabled={pending || busy}
      onClick={() => save(() => generateValidationAction(id))}
    >
      {pending || busy ? <Spinner /> : <Sparkles />}
      {busy ? "Generating…" : kit ? "Regenerate kit" : "Generate kit"}
    </Button>
  )
  return (
    <div className="grid gap-6">
      {kit ? (
        <Card>
          <CardHeader>
            <CardTitle>Validation kit</CardTitle>
            <CardDescription>
              Generated {ago(kit.generated_at)}. Paste the copy into a fake-door page and reply in the original thread.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div>{generate}</div>
            <CopyRow label="Headline" value={kit.headline} />
            <CopyRow label="Subheadline" value={kit.subheadline} />
            <CopyRow label="Bullets" value={kit.bullets.map((b) => `• ${b}`).join("\n")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <CopyRow label="Call to action" value={kit.cta} />
              <CopyRow label="Price" value={kit.price} />
            </div>
            <CopyRow label="Thread reply" value={kit.thread_reply} />
            <CopyRow label="Waitlist copy" value={kit.waitlist_copy} />
          </CardContent>
        </Card>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No validation kit yet</EmptyTitle>
            <EmptyDescription>
              Generate landing copy, a price and a thread reply from the quotes collected for this opportunity. The worker writes it in the
              background.
            </EmptyDescription>
          </EmptyHeader>
          {generate}
        </Empty>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Validation metrics <DecisionBadge decision={decision} />
          </CardTitle>
          <CardDescription>
            {metrics ? `Recorded ${ago(metrics.recorded_at)}. ` : ""}
            {DECISION_RULE}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            {[
              ["Waitlist sign-ups", waitlist, setWaitlist],
              ["Price clicks", clicks, setClicks],
              ["Replies", replies, setReplies],
            ].map(([name, value, set]) => (
              <div key={name as string} className="grid gap-2">
                <Label htmlFor={`val-${name}`}>{name as string}</Label>
                <Input
                  id={`val-${name}`}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={value as string}
                  onChange={(e) => (set as (v: string) => void)(e.target.value)}
                />
              </div>
            ))}
            <div className="grid gap-2">
              <Label htmlFor="val-started">Started</Label>
              <Input id="val-started" type="date" value={started} onChange={(e) => setStarted(e.target.value)} />
            </div>
          </div>
          <Button
            className="justify-self-start"
            disabled={pending}
            onClick={() =>
              save(() =>
                saveValidationMetricsAction(id, {
                  waitlist: Number(waitlist),
                  price_clicks: Number(clicks),
                  replies: Number(replies),
                  started_at: started || null,
                }),
              )
            }
          >
            {pending && <Spinner />}
            Save metrics
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
