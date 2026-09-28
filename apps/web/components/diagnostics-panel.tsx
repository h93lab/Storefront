"use client"

import * as React from "react"
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from "lucide-react"
import type { Check } from "@lens/core"
import { runDiagnosticsAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

const ICON = {
  ok: <CircleCheck className="size-4 text-success" aria-label="OK" />,
  warn: <TriangleAlert className="size-4 text-warning" aria-label="Warning" />,
  fail: <CircleX className="size-4 text-destructive" aria-label="Failed" />,
  skip: <CircleMinus className="size-4 text-muted-foreground" aria-label="Skipped" />,
}

export function DiagnosticsPanel() {
  const [link, setLink] = React.useState("")
  const [checks, setChecks] = React.useState<Check[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()
  return (
    <CardContent className="grid gap-4">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            setError(null)
            const r = await runDiagnosticsAction(link)
            if (r.ok) setChecks(r.data ?? [])
            else setError(r.error)
          })
        }}
      >
        <div className="grid flex-1 gap-2">
          <Label htmlFor="diag-link">
            Test a specific app <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="diag-link"
            placeholder="Paste an App Store or Google Play link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          {pending ? "Checking…" : "Run diagnostics"}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {checks && (
        <ul className="divide-y rounded-lg border">
          {checks.map((c) => (
            <li
              key={c.name}
              className="grid grid-cols-[1rem_1fr] items-start gap-3 p-3 text-sm sm:grid-cols-[1rem_minmax(0,14rem)_1fr_auto]"
            >
              <span className="mt-0.5">{ICON[c.status]}</span>
              <span className="font-medium">{c.name}</span>
              <span className="col-start-2 text-muted-foreground sm:col-start-auto">{c.detail}</span>
              <span className="col-start-2 text-xs text-muted-foreground tabular-nums sm:col-start-auto sm:text-right">{c.ms} ms</span>
            </li>
          ))}
        </ul>
      )}
    </CardContent>
  )
}
