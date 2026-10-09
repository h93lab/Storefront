import fs from "node:fs/promises"
import type { Metadata } from "next"
import { Cron } from "croner"
import {
  appllamaConnected,
  appllamaCredits,
  env,
  getSettings,
  listDevices,
  mediaUsageBytes,
  passwordConfigured,
  type AppllamaCredits,
} from "@lens/core"
import { AppllamaControls, AppllamaToasts } from "@/components/appllama-settings"
import { CopyButton } from "@/components/copy-button"
import { DiagnosticsPanel } from "@/components/diagnostics-panel"
import { PageHeader } from "@/components/page-header"
import { SecurityCard } from "@/components/security-card"
import { AiSettingsForm, EmbeddingSettingsForm, RedditSettingsForm, ScoreSettingsForm, SyncSettingsForm } from "@/components/settings-forms"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { deviceCookie } from "@/lib/auth-server"
import { bytes, date } from "@/lib/format"

export const metadata: Metadata = { title: "Settings" }

const TOOLS = [
  "search_library",
  "get_app",
  "get_screenshots",
  "view_screenshot",
  "get_reviews",
  "get_insights",
  "get_changes",
  "compare_apps",
  "search_store",
  "add_app",
  "sync_app",
  "list_boards",
  "get_board",
  "create_board",
  "save_to_board",
  "list_opportunities",
  "get_opportunity",
  "search_reviews",
  "save_gate_result",
  "save_spec",
  "set_opportunity_status",
  "record_outcome",
  "import_items",
  "record_verdict",
  "get_accuracy",
  "get_review_queue",
  "get_validation",
  "save_validation_metrics",
  "similar_opportunities",
  "market_search",
  "market_save",
  "get_market",
]

export default async function SettingsPage() {
  const settings = await getSettings()
  const [devices, passwordSet, thisDevice] = await Promise.all([listDevices(), passwordConfigured(), deviceCookie()])
  const used = await mediaUsageBytes()
  let disk: { total: number; free: number } | null = null
  try {
    await fs.mkdir(env.mediaDir, { recursive: true })
    const s = await fs.statfs(env.mediaDir)
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }
  } catch {
    disk = null
  }
  let nextRun: string | null = null
  try {
    const n = new Cron(settings.sync.cron, { paused: true, timezone: env.timezone }).nextRun()
    nextRun = n ? date(n, true) : null
  } catch {
    nextRun = null
  }
  const llamaOn = appllamaConnected(settings)
  let credits: AppllamaCredits | null = null
  let creditsError: string | null = null
  if (llamaOn) {
    try {
      credits = await appllamaCredits()
    } catch (e) {
      creditsError = e instanceof Error ? e.message : String(e)
    }
  }
  const usedToday = settings.appllama.usage.day === new Date().toISOString().slice(0, 10) ? settings.appllama.usage.calls : 0
  const key = settings.ai.apiKey
  const keyHint = key ? `…${key.slice(-4)}` : null
  const embKey = settings.ai.embedding.apiKey
  const embKeyHint = embKey ? `…${embKey.slice(-4)}` : null
  const rdSecret = settings.reddit.clientSecret
  const rdSecretHint = rdSecret ? `…${rdSecret.slice(-4)}` : null
  const { clientSecret: _s, apiBase: _a, ...redditInitial } = settings.reddit
  const mcpUrl = process.env.PUBLIC_MCP_URL ?? "http://localhost:3001/mcp"
  const token = process.env.MCP_TOKEN ?? ""
  const tokenShown = token ? `${token.slice(0, 4)}${"•".repeat(12)}${token.slice(-4)}` : "Not set"
  const claudeCmd = `claude mcp add --transport http storefront-lens ${mcpUrl} --header "Authorization: Bearer ${token || "<MCP_TOKEN>"}"`
  const jsonConfig = JSON.stringify(
    { mcpServers: { "storefront-lens": { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token || "<MCP_TOKEN>"}` } } } },
    null,
    2,
  )

  return (
    <>
      <PageHeader title="Settings" description="Security, AI provider, MCP access, sync schedule and diagnostics." />

      <Card id="diagnostics" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
          <CardDescription>
            Checks the database, the worker, image storage, both stores and your AI provider from this server.
          </CardDescription>
        </CardHeader>
        <DiagnosticsPanel />
      </Card>

      <Card id="security" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Your password, the PINs set up on your devices, and signing out.</CardDescription>
        </CardHeader>
        <SecurityCard
          passwordSet={passwordSet}
          devices={devices.map((d) => ({ ...d, current: d.id === thisDevice }))}
          hasPinHere={devices.some((d) => d.id === thisDevice)}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI provider</CardTitle>
          <CardDescription>
            Anthropic, or any OpenAI-compatible endpoint: OpenRouter, OpenAI, Ollama, vLLM, LM Studio and others.
          </CardDescription>
        </CardHeader>
        <AiSettingsForm
          initial={{
            provider: settings.ai.provider,
            baseUrl: settings.ai.baseUrl,
            model: settings.ai.model,
            autoAnalyse: settings.ai.autoAnalyse,
            batch: settings.ai.batch,
            keyHint,
          }}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Embeddings</CardTitle>
          <CardDescription>Optional. Lets grouping match labels to existing opportunities and shows similar ones.</CardDescription>
        </CardHeader>
        <EmbeddingSettingsForm
          initial={{
            baseUrl: settings.ai.embedding.baseUrl,
            model: settings.ai.embedding.model,
            dimensions: settings.ai.embedding.dimensions,
            keyHint: embKeyHint,
          }}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scoring</CardTitle>
          <CardDescription>How opportunities are ranked. Changes apply to every list and page immediately.</CardDescription>
        </CardHeader>
        <ScoreSettingsForm initial={settings.score} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reddit</CardTitle>
          <CardDescription>Optional extra evidence: public posts from the subreddits you choose that match your keywords.</CardDescription>
        </CardHeader>
        <RedditSettingsForm initial={redditInitial} secretHint={rdSecretHint} />
      </Card>

      <Card id="appllama" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Appllama</CardTitle>
          <CardDescription>
            Market data and every screen of the apps you pick, from your own Appllama Pro subscription. No API key: you sign in once.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <AppllamaToasts />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1 text-sm">
              <span className="flex items-center gap-2 font-medium">
                {llamaOn ? "Connected" : "Not connected"}
                <Badge variant={llamaOn ? "secondary" : "outline"}>{llamaOn ? "Active" : "Off"}</Badge>
              </span>
              {llamaOn && settings.appllama.connectedAt && (
                <span className="text-muted-foreground">Connected since {date(settings.appllama.connectedAt)}</span>
              )}
              {llamaOn && credits && (
                <span className="text-muted-foreground tabular-nums">
                  {credits.remaining.toLocaleString()} credits left this month
                  {credits.resets_on ? ` (resets ${date(credits.resets_on)})` : ""} · {usedToday} calls made today from here
                </span>
              )}
              {llamaOn && creditsError && <span className="text-destructive">Could not read credits: {creditsError}</span>}
            </div>
            <AppllamaControls connected={llamaOn} />
          </div>
          <p className="text-xs text-muted-foreground">
            Every Appllama call costs 1 credit. Saving an app costs about 1 + screens / 10 credits. Limits on Pro: 90 calls a minute, 400 a
            day, 1,500 a month; this app stops at 390 a day.
          </p>
          <p className="text-xs text-muted-foreground">
            Appllama&apos;s terms forbid harvesting the catalogue. Save the specific apps you study, do not sweep search results. Images
            carry a watermark and are for reference only.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>MCP server</CardTitle>
          <CardDescription>Connect Claude or any MCP client to your library. Endpoint and token come from your .env file.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="mcp-url">Endpoint</Label>
              <div className="flex gap-2">
                <Input id="mcp-url" readOnly className="font-mono text-sm" value={mcpUrl} />
                <CopyButton value={mcpUrl} label="Copy endpoint" iconOnly />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mcp-token">Bearer token</Label>
              <div className="flex gap-2">
                <Input id="mcp-token" readOnly className="font-mono text-sm" value={tokenShown} />
                {token && <CopyButton value={token} label="Copy token" iconOnly />}
              </div>
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Claude Code</Label>
              <CopyButton value={claudeCmd} label="Copy command" />
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
              {claudeCmd.replace(token || "\u0000", "<MCP_TOKEN>")}
            </pre>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>JSON config (Claude Desktop, Cursor, others)</Label>
              <CopyButton value={jsonConfig} label="Copy JSON" />
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
              {jsonConfig.replace(token || "\u0000", "<MCP_TOKEN>")}
            </pre>
          </div>
          <div className="grid gap-2">
            <Label>Tools</Label>
            <div className="flex flex-wrap gap-1.5">
              {TOOLS.map((t) => (
                <Badge key={t} variant="secondary" className="font-mono">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync</CardTitle>
          <CardDescription>Runs in the worker container on your server.</CardDescription>
        </CardHeader>
        <SyncSettingsForm initial={settings.sync} nextRun={nextRun} timezone={env.timezone} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>
            Images are stored as WebP in <span className="font-mono">{env.mediaDir}</span>. Back this folder up together with your database.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="flex justify-between text-sm">
            <span>Images</span>
            <span className="text-muted-foreground tabular-nums">
              {bytes(used)}
              {disk ? ` used · ${bytes(disk.free)} free on disk` : ""}
            </span>
          </div>
          {disk && <Progress value={Math.min(100, ((disk.total - disk.free) / disk.total) * 100)} aria-label="Disk usage" />}
        </CardContent>
      </Card>
    </>
  )
}
