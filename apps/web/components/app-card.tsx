"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, Ellipsis, ExternalLink, GitCompare, History, LoaderCircle, RefreshCw, Star, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { AppSummary } from "@lens/core"
import { removeAppAction, syncAppAction } from "@/app/actions"
import { AppIcon } from "@/components/app-icon"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ago, compact, FIELD_LABELS, mediaSrc, storeLabel } from "@/lib/format"

export function AppCard({ app }: { app: AppSummary }) {
  const router = useRouter()
  const [confirm, setConfirm] = React.useState(false)
  const busy = app.status === "pending" || app.status === "syncing"
  return (
    <Card className="group relative gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md">
      <Link
        href={`/apps/${app.id}`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={`Open ${app.name || app.store_id}`}
      />
      <div className="pointer-events-none flex h-44 gap-2 overflow-hidden bg-muted px-4 pt-4">
        {app.preview.length ? (
          app.preview.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p}
              src={mediaSrc(p, 240)!}
              alt=""
              loading="lazy"
              className="h-auto w-[30%] self-start rounded-t-lg border border-b-0 object-cover object-top"
            />
          ))
        ) : (
          <div className="flex w-full items-center justify-center text-sm text-muted-foreground">
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" />
                Fetching from the store…
              </span>
            ) : app.status === "error" ? (
              "Sync failed"
            ) : (
              "No screenshots"
            )}
          </div>
        )}
      </div>
      <div className="pointer-events-none relative grid gap-3 p-4">
        <div className="flex items-center gap-3">
          <AppIcon name={app.name} path={app.icon_path} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{app.name || app.store_id}</div>
            <div className="truncate text-xs text-muted-foreground">{app.developer ?? app.store_id}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{storeLabel(app.store)}</Badge>
          <Badge variant="secondary">{app.country.toUpperCase()}</Badge>
          {app.recent_change && (
            <Badge className="bg-warning/15 text-foreground">
              <History />
              {FIELD_LABELS[app.recent_change] ?? app.recent_change} changed
            </Badge>
          )}
          {app.status === "error" && (
            <Badge variant="destructive">
              <AlertTriangle />
              Error
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {app.rating != null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Star className="size-3 fill-star text-star" />
              {app.rating.toFixed(1)}
            </span>
          )}
          {app.ratings_count != null && <span className="tabular-nums">{compact(app.ratings_count)} ratings</span>}
          <span className="inline-flex items-center gap-1">
            <RefreshCw className="size-3" />
            {busy ? "syncing" : ago(app.last_synced_at)}
          </span>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="absolute top-2 right-2 z-10 size-8 bg-background opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
            aria-label="More actions"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="truncate">{app.name || app.store_id}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/apps/${app.id}`}>
              <ExternalLink />
              Open
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              const r = await syncAppAction(app.id)
              if (r.ok) toast.success("Sync queued")
              else toast.error(r.error)
              router.refresh()
            }}
          >
            <RefreshCw />
            Sync now
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/compare?ids=${app.id}`}>
              <GitCompare />
              Compare
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
            <Trash2 />
            Stop tracking
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Stop tracking ${app.name || app.store_id}?`}
        description="This deletes its stored screenshots, reviews, history and board items. You can add it again later, but history starts over."
        confirmLabel="Stop tracking"
        onConfirm={async () => {
          const r = await removeAppAction(app.id)
          if (r.ok) toast.success("App removed")
          else toast.error(r.error)
          router.refresh()
        }}
      />
    </Card>
  )
}
