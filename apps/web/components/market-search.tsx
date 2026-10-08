"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Download, Search, Star } from "lucide-react"
import { toast } from "sonner"
import type { SearchedApp } from "@lens/core"
import { appllamaBoardAction, appllamaBoardsAction, marketSaveAction, marketSaveManyAction, marketSearchAction } from "@/app/actions"
import { AppIcon } from "@/components/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { compact } from "@/lib/format"
import { cheapest, usd } from "@/lib/market"

const CONFIRM_ABOVE = 15
const SORTS = [
  ["relevance", "Relevance"],
  ["revenue", "Revenue"],
  ["downloads", "Downloads"],
  ["rating", "Rating"],
  ["recent", "Recently updated"],
  ["launched", "Launched"],
  ["name", "Name"],
]

const estimate = (a: { screens_count?: number | null }) => 1 + Math.ceil((a.screens_count ?? 0) / 10)

type Saved = Record<string, string> // appllama id -> library app id

interface Filters {
  query: string
  sort: string
  revenue_min: string
  rating_min: string
  launched_after: string
  price_max: string
  onboarding_steps_max: string
}

const num = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined)

function params(f: Filters, cursor?: string) {
  return {
    query: f.query.trim() || undefined,
    sort: f.sort === "relevance" && !f.query.trim() ? undefined : f.sort,
    revenue_min: num(f.revenue_min),
    rating_min: num(f.rating_min),
    launched_after: f.launched_after || undefined,
    price_max: num(f.price_max),
    onboarding_steps_max: num(f.onboarding_steps_max),
    cursor,
  }
}

export function MarketSearch({ savedMap, initialQuery }: { savedMap: Saved; initialQuery: string }) {
  const router = useRouter()
  const [f, setF] = React.useState<Filters>({
    query: initialQuery,
    sort: "relevance",
    revenue_min: "",
    rating_min: "",
    launched_after: "",
    price_max: "",
    onboarding_steps_max: "",
  })
  const [apps, setApps] = React.useState<SearchedApp[]>([])
  const [total, setTotal] = React.useState<number | null>(null)
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [searched, setSearched] = React.useState(false)
  const [pending, start] = React.useTransition()
  const [queued, setQueued] = React.useState<Set<string>>(new Set())
  const [confirm, setConfirm] = React.useState<SearchedApp | null>(null)
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }))

  const run = (more = false) =>
    start(async () => {
      const r = await marketSearchAction(params(f, more ? (cursor ?? undefined) : undefined))
      if (!r.ok || !r.data) {
        toast.error(r.ok ? "No response from Appllama" : r.error)
        return
      }
      setApps((cur) => (more ? [...cur, ...r.data!.apps] : r.data!.apps))
      setTotal(r.data.total ?? null)
      setCursor(r.data.next_cursor ?? null)
      setSearched(true)
      if (!more) router.refresh()
    })

  const autoRan = React.useRef(false)
  React.useEffect(() => {
    if (autoRan.current || !initialQuery) return
    autoRan.current = true
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (a: SearchedApp) => {
    const r = await marketSaveAction({ appllamaId: String(a.app_id), screensCount: a.screens_count, appId: a.library_app_id })
    if (r.ok) {
      toast.success(`Saving ${a.name} (about ${r.data?.estimate} credits)`)
      setQueued((q) => new Set(q).add(String(a.app_id)))
      router.refresh()
    } else toast.error(r.error)
  }

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 rounded-xl border p-4"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="e.g. habit tracker, calorie tracking with a paywall quiz"
              aria-label="Search Appllama"
              value={f.query}
              onChange={set("query")}
            />
          </div>
          <Select value={f.sort} onValueChange={(v) => setF((x) => ({ ...x, sort: v }))}>
            <SelectTrigger className="w-44" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : <Search />}
            Search (1 credit)
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ["revenue_min", "Revenue min ($/mo)", "number"],
              ["rating_min", "Rating min", "number"],
              ["launched_after", "Launched after", "date"],
              ["price_max", "Price max ($)", "number"],
              ["onboarding_steps_max", "Onboarding steps max", "number"],
            ] as const
          ).map(([k, label, type]) => (
            <div key={k} className="grid gap-1.5">
              <Label htmlFor={`mk-${k}`} className="text-xs text-muted-foreground">
                {label}
              </Label>
              <Input id={`mk-${k}`} type={type} min={type === "number" ? 0 : undefined} value={f[k]} onChange={set(k)} />
            </div>
          ))}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {searched ? `${total ?? apps.length} result${total === 1 ? "" : "s"}` : "Every search or page costs 1 credit. Saving costs more."}
        </p>
        <BoardImport savedMap={savedMap} />
      </div>

      {apps.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((a) => {
            const id = String(a.app_id)
            const libId = savedMap[id] ?? a.library_app_id
            const saved = a.saved || Boolean(savedMap[id])
            const busy = queued.has(id) && !saved
            const monthly = cheapest(a.in_app_purchases, "Monthly")
            const annual = cheapest(a.in_app_purchases, "Annual")
            const n = estimate(a)
            return (
              <Card key={id} className="gap-3 p-4">
                <div className="flex items-start gap-3">
                  <AppIcon name={a.name} path={null} className="size-12" />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{a.publisher ?? "—"}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {saved && libId ? (
                        <Badge asChild>
                          <Link href={`/apps/${libId}?tab=market`}>Saved</Link>
                        </Badge>
                      ) : null}
                      {libId ? (
                        <Badge variant="outline" asChild>
                          <Link href={`/apps/${libId}`}>In library</Link>
                        </Badge>
                      ) : null}
                      {busy && <Badge variant="secondary">Queued</Badge>}
                    </div>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Revenue</dt>
                  <dd className="text-right tabular-nums">{a.revenue?.display ?? "—"}</dd>
                  <dt className="text-muted-foreground">Downloads</dt>
                  <dd className="text-right tabular-nums">{a.downloads?.display ?? compact(a.downloads?.value)}</dd>
                  <dt className="text-muted-foreground">Rating</dt>
                  <dd className="inline-flex items-center justify-end gap-1 tabular-nums">
                    {a.rating?.average != null ? (
                      <>
                        <Star className="size-3 fill-star text-star" />
                        {a.rating.average.toFixed(1)} <span className="text-muted-foreground">({compact(a.rating.count)})</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Price</dt>
                  <dd className="text-right tabular-nums">
                    {monthly != null || annual != null
                      ? `${monthly != null ? `${usd(monthly)}/mo` : ""}${monthly != null && annual != null ? " · " : ""}${annual != null ? `${usd(annual)}/yr` : ""}`
                      : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Screens</dt>
                  <dd className="text-right tabular-nums">{a.screens_count ?? "—"}</dd>
                  <dt className="text-muted-foreground">Launched</dt>
                  <dd className="text-right tabular-nums">{a.launched ?? "—"}</dd>
                </dl>
                {a.flows && a.flows.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {a.flows.slice(0, 4).map((fl) => (
                      <Badge key={fl.name} variant="secondary" className="font-normal">
                        {fl.name} <span className="opacity-60">{fl.screens}</span>
                      </Badge>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  variant={saved ? "outline" : "default"}
                  disabled={busy}
                  onClick={() => (n > CONFIRM_ABOVE ? setConfirm(a) : save(a))}
                >
                  <Download />
                  {saved ? `Re-save (≈${n} credits)` : busy ? "Queued" : `Save (≈${n} credits)`}
                </Button>
              </Card>
            )
          })}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{searched ? "No apps found" : "Search Appllama"}</EmptyTitle>
            <EmptyDescription>
              {searched
                ? "Try a broader query or loosen the filters."
                : "Describe the kind of app you want to study. Pick specific apps to save: the profile and every screen are stored on your server."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {cursor && (
        <Button variant="outline" className="justify-self-center" disabled={pending} onClick={() => run(true)}>
          {pending && <Spinner />}
          Load more (1 credit)
        </Button>
      )}

      <Dialog open={confirm != null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save {confirm?.name}?</DialogTitle>
            <DialogDescription>
              This app has {confirm?.screens_count ?? 0} screens, so saving it costs about {confirm ? estimate(confirm) : 0} Appllama
              credits.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const a = confirm
                setConfirm(null)
                if (a) await save(a)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BoardImport({ savedMap }: { savedMap: Saved }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [boards, setBoards] = React.useState<{ board_id: string; name: string; kind: string; item_count?: number }[] | null>(null)
  const [boardId, setBoardId] = React.useState("")
  const [apps, setApps] = React.useState<SearchedApp[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [pending, start] = React.useTransition()

  const loadBoards = () =>
    start(async () => {
      const r = await appllamaBoardsAction()
      if (r.ok) setBoards((r.data ?? []).filter((b) => b.kind === "apps"))
      else toast.error(r.error)
    })

  const load = (id: string, c?: string) =>
    start(async () => {
      const r = await appllamaBoardAction(id, c)
      if (!r.ok || !r.data) {
        if (!r.ok) toast.error(r.error)
        return
      }
      const list = r.data.apps
      setApps((cur) => (c ? [...cur, ...list] : list))
      setCursor((r.data.next_cursor as string | null) ?? null)
      if (!c)
        setPicked(
          new Set(
            list
              .filter((a) => !a.saved && !savedMap[String(a.app_id)])
              .slice(0, 20)
              .map((a) => String(a.app_id)),
          ),
        )
    })

  const chosen = apps.filter((a) => picked.has(String(a.app_id)))
  const total = chosen.reduce((s, a) => s + estimate(a), 0)
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else if (n.size < 20) n.add(id)
      else toast.error("At most 20 apps per batch")
      return n
    })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o && !boards) loadBoards()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Import a board
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import an Appllama board</DialogTitle>
          <DialogDescription>Apps boards only. Pick up to 20 apps; each is saved with all of its screens.</DialogDescription>
        </DialogHeader>
        <Select
          value={boardId}
          onValueChange={(v) => {
            setBoardId(v)
            setApps([])
            load(v)
          }}
        >
          <SelectTrigger className="w-full" aria-label="Board">
            <SelectValue placeholder={boards ? (boards.length ? "Choose a board" : "No apps boards") : "Loading boards…"} />
          </SelectTrigger>
          <SelectContent>
            {(boards ?? []).map((b) => (
              <SelectItem key={b.board_id} value={b.board_id}>
                {b.name}
                {b.item_count != null ? ` (${b.item_count})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pending && apps.length === 0 && boardId ? <Spinner /> : null}
        {apps.length > 0 && (
          <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
            {apps.map((a) => {
              const id = String(a.app_id)
              const saved = a.saved || Boolean(savedMap[id])
              return (
                <label key={id} className="flex cursor-pointer items-center gap-3 p-2.5 text-sm">
                  <input type="checkbox" className="size-4" checked={picked.has(id)} onChange={() => toggle(id)} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  {saved && <Badge variant="secondary">Saved</Badge>}
                  <span className="text-xs text-muted-foreground tabular-nums">≈{estimate(a)} credits</span>
                </label>
              )
            })}
          </div>
        )}
        {cursor && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => load(boardId, cursor)}>
            Load more (1 credit)
          </Button>
        )}
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums">
            {chosen.length} selected · ≈{total} credits
          </span>
          <Button
            disabled={pending || chosen.length === 0}
            onClick={() =>
              start(async () => {
                const r = await marketSaveManyAction(chosen.map((a) => String(a.app_id)))
                if (r.ok) {
                  toast.success(`Saving ${r.data?.queued} apps (about ${total} credits)`)
                  setOpen(false)
                  router.refresh()
                } else toast.error(r.error)
              })
            }
          >
            Save {chosen.length} apps
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
