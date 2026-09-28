"use client"

import * as React from "react"
import { Star } from "lucide-react"
import { DebouncedSearch, useUrlState } from "@/components/library-filters"
import { SaveButton, SaveToBoardDialog, type BoardOption } from "@/components/save-to-board"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export interface ReviewRow {
  review_id: string
  author: string | null
  rating: number | null
  title: string | null
  body: string | null
  app_version: string | null
  reviewed_at: string | null
  sentiment: string | null
  topic: string | null
  label: string | null
}

export function Stars({ rating }: { rating: number | null }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${rating ?? 0} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("size-3.5", i <= (rating ?? 0) ? "fill-star text-star" : "text-border")} />
      ))}
    </span>
  )
}

const SENTIMENT: Record<string, { label: string; className: string }> = {
  positive: { label: "Positive", className: "bg-success/15 text-success" },
  negative: { label: "Negative", className: "bg-destructive/15 text-destructive" },
  neutral: { label: "Neutral", className: "" },
}

export function ReviewsPanel({
  appId,
  appName,
  rows,
  total,
  topics,
  boards,
  limit,
}: {
  appId: string
  appName: string
  rows: ReviewRow[]
  total: number
  topics: { topic: string; count: number }[]
  boards: BoardOption[]
  limit: number
}) {
  const { params, set } = useUrlState()
  const [saving, setSaving] = React.useState<ReviewRow | null>(null)
  const topic = params.get("topic")
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <DebouncedSearch placeholder="Search reviews…" />
        <Tabs value={params.get("rating") ?? "all"} onValueChange={(v) => set({ rating: v, limit: null })}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pos">4–5★</TabsTrigger>
            <TabsTrigger value="neu">3★</TabsTrigger>
            <TabsTrigger value="neg">1–2★</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={params.get("sort") ?? "new"} onValueChange={(v) => set({ sort: v === "new" ? null : v })}>
          <SelectTrigger className="w-40" aria-label="Sort reviews">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">Newest</SelectItem>
            <SelectItem value="low">Lowest rating</SelectItem>
            <SelectItem value="high">Highest rating</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">AI topics</span>
          {topics.map((t) => (
            <Button
              key={t.topic}
              variant={topic === t.topic ? "secondary" : "outline"}
              size="sm"
              className={cn("h-7 rounded-full px-3 text-xs", topic !== t.topic && "border-dashed text-muted-foreground")}
              aria-pressed={topic === t.topic}
              onClick={() => set({ topic: topic === t.topic ? null : t.topic, limit: null })}
            >
              {t.topic}
              <span className="tabular-nums opacity-60">{t.count}</span>
            </Button>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground tabular-nums">
        {total.toLocaleString()} review{total === 1 ? "" : "s"}
        {rows.length < total ? ` · showing ${rows.length}` : ""}
      </p>
      <div className="divide-y rounded-xl border bg-card">
        {rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No reviews match these filters.</p>}
        {rows.map((r) => (
          <article key={r.review_id} className="grid gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Stars rating={r.rating} />
                <span className="truncate font-medium">{r.title || "Untitled review"}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {r.author ?? "Anonymous"}
                  {r.reviewed_at
                    ? ` · ${new Date(r.reviewed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                    : ""}
                  {r.app_version ? ` · v${r.app_version}` : ""}
                </span>
                <SaveButton onClick={() => setSaving(r)} label="Save review to board" />
              </div>
            </div>
            {r.body && (
              <p className="max-w-prose text-sm whitespace-pre-line text-muted-foreground" dir="auto">
                {r.body}
              </p>
            )}
            {(r.sentiment || r.topic || r.label) && (
              <div className="flex flex-wrap gap-1.5">
                {r.sentiment && (
                  <Badge variant="secondary" className={SENTIMENT[r.sentiment]?.className}>
                    {SENTIMENT[r.sentiment]?.label ?? r.sentiment}
                  </Badge>
                )}
                {r.topic && <Badge variant="outline">{r.topic}</Badge>}
                {r.label && (
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    {r.label}
                  </Badge>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {rows.length < total && (
        <Button variant="outline" className="justify-self-center" onClick={() => set({ limit: String(limit + 50) })}>
          Show more
        </Button>
      )}
      <SaveToBoardDialog
        open={saving != null}
        onOpenChange={(o) => !o && setSaving(null)}
        target={saving ? { kind: "review", appId, reviewId: saving.review_id } : null}
        boards={boards}
        subject={saving ? `${appName} · “${saving.title || saving.body?.slice(0, 60) || "review"}”` : ""}
      />
    </div>
  )
}
