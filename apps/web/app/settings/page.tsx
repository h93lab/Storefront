import fs from "node:fs/promises"
import type { Metadata } from "next"
import { Cron } from "croner"
import { env, getSettings, mediaUsageBytes } from "@lens/core"
import { CopyButton } from "@/components/copy-button"
import { DiagnosticsPanel } from "@/components/diagnostics-panel"
import { PageHeader } from "@/components/page-header"
import { AiSettingsForm, SyncSettingsForm } from "@/components/settings-forms"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
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
]

export default async function SettingsPage() {
  const settings = await getSettings()
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
  const key = settings.ai.apiKey
  const keyHint = key ? `…${key.slice(-4)}` : null
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
      <PageHeader title="Settings" description="AI provider, MCP access, sync schedule and diagnostics." />

      <Card id="diagnostics" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
          <CardDescription>
            Checks the database, the worker, image storage, both stores and your AI provider from this server.
          </CardDescription>
        </CardHeader>
        <DiagnosticsPanel />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI provider</CardTitle>
          <CardDescription>Any OpenAI-compatible endpoint: OpenRouter, OpenAI, Ollama, vLLM, LM Studio and others.</CardDescription>
        </CardHeader>
        <AiSettingsForm
          initial={{ baseUrl: settings.ai.baseUrl, model: settings.ai.model, autoAnalyse: settings.ai.autoAnalyse, keyHint }}
        />
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
