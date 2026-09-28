"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { clearAiKeyAction, saveAiSettingsAction, saveSyncSettingsAction, testAiAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { CardContent, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"

export function AiSettingsForm({ initial }: { initial: { baseUrl: string; model: string; autoAnalyse: boolean; keyHint: string | null } }) {
  const router = useRouter()
  const [baseUrl, setBaseUrl] = React.useState(initial.baseUrl)
  const [apiKey, setApiKey] = React.useState("")
  const [model, setModel] = React.useState(initial.model)
  const [autoAnalyse, setAutoAnalyse] = React.useState(initial.autoAnalyse)
  const [saving, startSave] = React.useTransition()
  const [testing, startTest] = React.useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startSave(async () => {
          const r = await saveAiSettingsAction({ baseUrl, apiKey, model, autoAnalyse })
          if (r.ok) {
            toast.success("AI settings saved")
            setApiKey("")
            router.refresh()
          } else toast.error(r.error)
        })
      }}
    >
      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="ai-url">Base URL</Label>
          <Input
            id="ai-url"
            className="font-mono text-sm"
            placeholder="https://openrouter.ai/api/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The part before <span className="font-mono">/chat/completions</span>. Examples:{" "}
            <span className="font-mono">https://api.openai.com/v1</span>, <span className="font-mono">http://ollama:11434/v1</span>
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ai-key">API key</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              className="font-mono text-sm"
              placeholder={initial.keyHint ? `Saved (${initial.keyHint})` : "Not set"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to keep the saved key.
              {initial.keyHint && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={async () => {
                      const r = await clearAiKeyAction()
                      if (r.ok) toast.success("API key removed")
                      router.refresh()
                    }}
                  >
                    Remove key
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              className="font-mono text-sm"
              placeholder="provider/model-name"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Exactly as your provider names it.</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="grid gap-0.5">
            <Label htmlFor="ai-auto">Analyse new reviews after each sync</Label>
            <p className="text-xs text-muted-foreground">Only unanalysed reviews are sent, which keeps cost down.</p>
          </div>
          <Switch id="ai-auto" checked={autoAnalyse} onCheckedChange={setAutoAnalyse} />
        </div>
      </CardContent>
      <CardFooter className="mt-6 gap-2">
        <Button type="submit" disabled={saving}>
          {saving && <Spinner />}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={testing || !baseUrl || !model}
          onClick={() =>
            startTest(async () => {
              const r = await testAiAction({ baseUrl, apiKey, model })
              if (r.ok) toast.success("Connection works", { description: `The model answered in ${r.data} ms.` })
              else toast.error("Connection failed", { description: r.error })
            })
          }
        >
          {testing && <Spinner />}
          Test connection
        </Button>
      </CardFooter>
    </form>
  )
}

const PRESETS: [string, string][] = [
  ["0 3 * * *", "Daily at 03:00"],
  ["0 3,15 * * *", "Twice a day (03:00, 15:00)"],
  ["0 3 * * 1", "Weekly on Monday 03:00"],
]

export function SyncSettingsForm({
  initial,
  nextRun,
  timezone,
}: {
  initial: { cron: string; reviewsPerApp: number }
  nextRun: string | null
  timezone: string
}) {
  const router = useRouter()
  const isPreset = PRESETS.some(([c]) => c === initial.cron)
  const [mode, setMode] = React.useState(isPreset ? initial.cron : "custom")
  const [cron, setCron] = React.useState(initial.cron)
  const [reviews, setReviews] = React.useState(String(initial.reviewsPerApp))
  const [pending, start] = React.useTransition()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await saveSyncSettingsAction({ cron: mode === "custom" ? cron : mode, reviewsPerApp: Number(reviews) })
          if (r.ok) toast.success("Sync settings saved", { description: "The worker applies the new schedule within a minute." })
          else toast.error(r.error)
          router.refresh()
        })
      }}
    >
      <CardContent className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Schedule</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="w-full" aria-label="Schedule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map(([c, l]) => (
                  <SelectItem key={c} value={c}>
                    {l}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom cron…</SelectItem>
              </SelectContent>
            </Select>
            {mode === "custom" && (
              <Input
                aria-label="Cron expression"
                className="font-mono text-sm"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 3 * * *"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Time zone {timezone} (set <span className="font-mono">TZ</span> in .env).{nextRun ? ` Next run ${nextRun}.` : ""}
            </p>
          </div>
          <div className="grid gap-2">
            <Label>Reviews kept per app</Label>
            <Select value={reviews} onValueChange={setReviews}>
              <SelectTrigger className="w-full" aria-label="Reviews per app">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["200", "500", "1000", "2000"].map((n) => (
                  <SelectItem key={n} value={n}>
                    Latest {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">The App Store feed returns at most 500 per country.</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="mt-6">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          Save
        </Button>
      </CardFooter>
    </form>
  )
}
