"use client"

import * as React from "react"
import { toast } from "sonner"
import { importItemsAction } from "@/app/actions"
import { AppIcon } from "@/components/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

export function ImportForm({ apps }: { apps: { id: string; name: string; icon: string | null }[] }) {
  const [text, setText] = React.useState("")
  const [source, setSource] = React.useState("paste")
  const [url, setUrl] = React.useState("")
  const [appId, setAppId] = React.useState("none")
  const [pending, start] = React.useTransition()
  const count = text.split(/\r?\n\s*\r?\n/).filter((t) => t.trim()).length
  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await importItemsAction({ text, source, url, appId: appId === "none" ? undefined : appId })
          if (r.ok && r.data) {
            toast.success(`Imported ${r.data.inserted}, skipped ${r.data.skipped}`, {
              description: r.data.inserted ? "The worker is analysing the new items." : "Nothing new to analyse.",
            })
            setText("")
          } else if (!r.ok) toast.error(r.error)
        })
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="import-text">Items</Label>
        <Textarea
          id="import-text"
          required
          rows={12}
          placeholder={"Paste one complaint or request per paragraph.\n\nSeparate items with a blank line."}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="text-xs text-muted-foreground tabular-nums">{count} item(s) detected</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="import-source">Source</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger id="import-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paste">Paste</SelectItem>
              <SelectItem value="reddit">Reddit</SelectItem>
              <SelectItem value="support">Support tickets</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="import-app">About app (optional)</Label>
          <Select value={appId} onValueChange={setAppId}>
            <SelectTrigger id="import-app" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No app</SelectItem>
              {apps.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <AppIcon name={a.name} path={a.icon} className="size-4 rounded-sm text-[10px]" />
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="import-url">Source URL (optional)</Label>
        <Input id="import-url" type="url" placeholder="https://reddit.com/r/…" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <Button type="submit" className="justify-self-start" disabled={pending || !count}>
        {pending && <Spinner />}
        Import
      </Button>
    </form>
  )
}
