"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  clearAiKeyAction,
  clearEmbeddingKeyAction,
  clearRedditSecretAction,
  fetchRedditAction,
  reanalyseAllAction,
  saveAiSettingsAction,
  saveEmbeddingSettingsAction,
  saveRedditSettingsAction,
  saveScoreSettingsAction,
  saveSyncSettingsAction,
  testAiAction,
  testEmbeddingAction,
} from "@/app/actions"
import { Button } from "@/components/ui/button"
import { CardContent, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { Settings } from "@lens/core"

export function AiSettingsForm({
  initial,
}: {
  initial: {
    provider: Settings["ai"]["provider"]
    baseUrl: string
    model: string
    autoAnalyse: boolean
    batch: boolean
    keyHint: string | null
  }
}) {
  const router = useRouter()
  const [provider, setProvider] = React.useState(initial.provider)
  const [batch, setBatch] = React.useState(initial.batch)
  const anthropic = provider === "anthropic"
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
          const r = await saveAiSettingsAction({ provider, baseUrl, apiKey, model, autoAnalyse, batch })
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
          <Label>Provider</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as Settings["ai"]["provider"])}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI-compatible</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ai-url">Base URL{anthropic ? " (optional)" : ""}</Label>
          <Input
            id="ai-url"
            className="font-mono text-sm"
            placeholder={anthropic ? "Leave empty for api.anthropic.com" : "https://openrouter.ai/api/v1"}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {anthropic ? (
              "Only needed for a proxy or gateway."
            ) : (
              <>
                The part before <span className="font-mono">/chat/completions</span>. Examples:{" "}
                <span className="font-mono">https://api.openai.com/v1</span>, <span className="font-mono">http://ollama:11434/v1</span>
              </>
            )}
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
              placeholder={anthropic ? "claude-haiku-4-5" : "provider/model-name"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Exactly as your provider names it.
              {anthropic && " Prompt caching only applies to prompts of at least 4096 tokens on Haiku 4.5 and 512 on Sonnet/Opus."}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="grid gap-0.5">
            <Label htmlFor="ai-auto">Analyse new reviews after each sync</Label>
            <p className="text-xs text-muted-foreground">Only unanalysed reviews are sent, which keeps cost down.</p>
          </div>
          <Switch id="ai-auto" checked={autoAnalyse} onCheckedChange={setAutoAnalyse} />
        </div>
        {anthropic && (
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <Label htmlFor="ai-batch">Use Message Batches (50% cheaper, results within ~1h)</Label>
              <p className="text-xs text-muted-foreground">
                Classification is submitted as a batch and collected by the worker when it finishes.
              </p>
            </div>
            <Switch id="ai-batch" checked={batch} onCheckedChange={setBatch} />
          </div>
        )}
      </CardContent>
      <CardFooter className="mt-6 gap-2">
        <Button type="submit" disabled={saving}>
          {saving && <Spinner />}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={testing || (!anthropic && !baseUrl) || !model}
          onClick={() =>
            startTest(async () => {
              const r = await testAiAction({ provider, baseUrl, apiKey, model })
              if (r.ok) toast.success("Connection works", { description: `The model answered in ${r.data} ms.` })
              else toast.error("Connection failed", { description: r.error })
            })
          }
        >
          {testing && <Spinner />}
          Test connection
        </Button>
        <ReanalyseAllButton disabled={!initial.model || (initial.provider !== "anthropic" && !initial.baseUrl)} />
      </CardFooter>
    </form>
  )
}

/** Sends every review classified by an older analyser (or never classified) through the model again. */
function ReanalyseAllButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = React.useTransition()
  return (
    <Button
      type="button"
      variant="ghost"
      className="ml-auto"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const r = await reanalyseAllAction()
          if (r.ok) toast.success("Re-analysis queued", { description: "Apps with outdated or missing analysis are processed one by one." })
          else toast.error(r.error)
        })
      }
    >
      {pending && <Spinner />}
      Re-analyse all apps
    </Button>
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

export function EmbeddingSettingsForm({
  initial,
}: {
  initial: { baseUrl: string; model: string; dimensions: number; keyHint: string | null }
}) {
  const router = useRouter()
  const [baseUrl, setBaseUrl] = React.useState(initial.baseUrl)
  const [apiKey, setApiKey] = React.useState("")
  const [model, setModel] = React.useState(initial.model)
  const [dimensions, setDimensions] = React.useState(String(initial.dimensions))
  const [dims, setDims] = React.useState<number | null>(null)
  const [saving, startSave] = React.useTransition()
  const [testing, startTest] = React.useTransition()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startSave(async () => {
          const r = await saveEmbeddingSettingsAction({ baseUrl, apiKey, model, dimensions: Number(dimensions) })
          if (r.ok) {
            toast.success("Embedding settings saved")
            setApiKey("")
          } else toast.error(r.error)
          router.refresh()
        })
      }}
    >
      <CardContent className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="emb-url">Base URL</Label>
            <Input
              id="emb-url"
              className="font-mono text-sm"
              placeholder="https://api.voyageai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="emb-model">Model</Label>
            <Input
              id="emb-model"
              className="font-mono text-sm"
              placeholder="voyage-3.5"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="emb-key">API key</Label>
            <Input
              id="emb-key"
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
                      const r = await clearEmbeddingKeyAction()
                      if (r.ok) toast.success("Embedding key removed")
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
            <Label htmlFor="emb-dim">Dimensions</Label>
            <Input
              id="emb-dim"
              type="number"
              min={1}
              max={4096}
              inputMode="numeric"
              value={dimensions}
              onChange={(e) => setDimensions(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Must match what the model returns.</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Optional. Any OpenAI-shaped <span className="font-mono">/embeddings</span> endpoint works: Voyage (
          <span className="font-mono">https://api.voyageai.com/v1</span>) or OpenAI (
          <span className="font-mono">https://api.openai.com/v1</span>
          ). Leave the base URL empty to turn embeddings off; grouping then relies on the model alone.
        </p>
        {dims != null && <p className="text-sm tabular-nums">The provider returned {dims} dimensions.</p>}
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
              const r = await testEmbeddingAction({ baseUrl, apiKey, model, dimensions: Number(dimensions) })
              if (r.ok) {
                setDims(r.data ?? null)
                toast.success("Embeddings work", { description: `"hello" produced a vector of ${r.data} dimensions.` })
              } else toast.error("Embedding test failed", { description: r.error })
            })
          }
        >
          {testing && <Spinner />}
          Test
        </Button>
      </CardFooter>
    </form>
  )
}

const SCORE_FIELDS: { key: keyof Settings["score"]; label: string; hint: string; step: string }[] = [
  { key: "listingWeight", label: "Listing weight", hint: "Points per distinct store listing that shows the complaint.", step: "0.1" },
  { key: "painWeight", label: "Pain weight", hint: "Multiplies the average pain score (0 to 5).", step: "0.1" },
  { key: "wtpWeight", label: "Willingness-to-pay weight", hint: "Multiplies the share of evidence with a WTP signal.", step: "0.1" },
  { key: "halfLifeDays", label: "Half-life (days)", hint: "Evidence loses half its weight after this many days.", step: "1" },
  {
    key: "autoMapThreshold",
    label: "Auto-map threshold",
    hint: "With embeddings on, labels at least this similar (0.5 to 1) to an opportunity join it without the model.",
    step: "0.01",
  },
]

export function ScoreSettingsForm({ initial }: { initial: Settings["score"] }) {
  const router = useRouter()
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, String(initial[f.key])])),
  )
  const [pending, start] = React.useTransition()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await saveScoreSettingsAction(
            Object.fromEntries(SCORE_FIELDS.map((f) => [f.key, Number(values[f.key])])) as Settings["score"],
          )
          if (r.ok) toast.success("Scoring saved", { description: "Scores are recomputed on the next page load." })
          else toast.error(r.error)
          router.refresh()
        })
      }}
    >
      <CardContent className="grid gap-5 sm:grid-cols-2">
        {SCORE_FIELDS.map((f) => (
          <div key={f.key} className="grid content-start gap-2">
            <Label htmlFor={`score-${f.key}`}>{f.label}</Label>
            <Input
              id={`score-${f.key}`}
              type="number"
              step={f.step}
              min={0}
              inputMode="decimal"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          </div>
        ))}
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

export function RedditSettingsForm({
  initial,
  secretHint,
}: {
  initial: Omit<Settings["reddit"], "clientSecret" | "apiBase">
  secretHint: string | null
}) {
  const router = useRouter()
  const [enabled, setEnabled] = React.useState(initial.enabled)
  const [clientId, setClientId] = React.useState(initial.clientId)
  const [secret, setSecret] = React.useState("")
  const [userAgent, setUserAgent] = React.useState(initial.userAgent)
  const [subreddits, setSubreddits] = React.useState(initial.subreddits.join("\n"))
  const [keywords, setKeywords] = React.useState(initial.keywords.join("\n"))
  const [limit, setLimit] = React.useState(String(initial.limit))
  const [saving, startSave] = React.useTransition()
  const [fetching, startFetch] = React.useTransition()
  const lines = (t: string) => t.split(/\r?\n/)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startSave(async () => {
          const r = await saveRedditSettingsAction({
            enabled,
            clientId,
            clientSecret: secret,
            userAgent,
            subreddits: lines(subreddits),
            keywords: lines(keywords),
            limit: Number(limit),
          })
          if (r.ok) {
            toast.success("Reddit settings saved")
            setSecret("")
          } else toast.error(r.error)
          router.refresh()
        })
      }}
    >
      <CardContent className="grid gap-5">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="grid gap-0.5">
            <Label htmlFor="rd-enabled">Collect Reddit posts</Label>
            <p className="text-xs text-muted-foreground">Matching posts become imported items and are analysed like reviews.</p>
          </div>
          <Switch id="rd-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="rd-id">Client id</Label>
            <Input
              id="rd-id"
              className="font-mono text-sm"
              autoComplete="off"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rd-secret">Client secret</Label>
            <Input
              id="rd-secret"
              type="password"
              autoComplete="off"
              className="font-mono text-sm"
              placeholder={secretHint ? `Saved (${secretHint})` : "Not set"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to keep the saved secret.
              {secretHint && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={async () => {
                      const r = await clearRedditSecretAction()
                      if (r.ok) toast.success("Reddit secret removed")
                      router.refresh()
                    }}
                  >
                    Remove secret
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rd-ua">User agent</Label>
            <Input
              id="rd-ua"
              className="font-mono text-sm"
              placeholder="web:storefront-lens:1.0 (by u/your-name)"
              value={userAgent}
              onChange={(e) => setUserAgent(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rd-limit">Posts per subreddit</Label>
            <Input
              id="rd-limit"
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rd-subs">Subreddits</Label>
            <Textarea
              id="rd-subs"
              className="font-mono text-sm"
              rows={5}
              placeholder={"iphone\nproductivity"}
              value={subreddits}
              onChange={(e) => setSubreddits(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">One per line, without r/.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rd-kw">Keywords</Label>
            <Textarea
              id="rd-kw"
              className="font-mono text-sm"
              rows={5}
              placeholder={"is there an app\nwish there was an app"}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">One per line. A post must contain at least one.</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Create a &ldquo;script&rdquo; app at reddit.com/prefs/apps to get the id and secret. Only public posts are read through the
          official API, within its rate limits and terms; posts are used for private research and never republished.
        </p>
      </CardContent>
      <CardFooter className="mt-6 gap-2">
        <Button type="submit" disabled={saving}>
          {saving && <Spinner />}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={fetching || !initial.enabled || !initial.clientId || !secretHint}
          onClick={() =>
            startFetch(async () => {
              const r = await fetchRedditAction()
              if (r.ok) toast.success("Reddit fetch queued", { description: "New posts appear under Import once the worker has run." })
              else toast.error(r.error)
            })
          }
        >
          {fetching && <Spinner />}
          Fetch now
        </Button>
      </CardFooter>
    </form>
  )
}
