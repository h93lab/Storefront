import type { Metadata } from "next"
import Link from "next/link"
import { Star } from "lucide-react"
import { compareApps, listApps } from "@lens/core"
import { AppIcon } from "@/components/app-icon"
import { ComparePicker, RemoveFromCompare } from "@/components/compare-picker"
import { PageHeader } from "@/components/page-header"
import { Card } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { bytes, compact, date, storeLabel } from "@/lib/format"

export const metadata: Metadata = { title: "Compare" }

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const ids = [...new Set(((await searchParams).ids ?? "").split(",").filter(Boolean))].slice(0, 8)
  const [apps, all] = await Promise.all([compareApps(ids), listApps()])
  const selected = apps.map((a) => a.id)
  const bestRating = Math.max(...apps.map((a) => a.rating ?? 0))

  type Row = [string, (a: (typeof apps)[number]) => React.ReactNode]
  const rows: Row[] = [
    ["Store", (a) => `${storeLabel(a.store)} · ${a.country.toUpperCase()}`],
    [
      "Rating",
      (a) =>
        a.rating != null ? (
          <span className={`inline-flex items-center gap-1 ${a.rating === bestRating && apps.length > 1 ? "font-semibold" : ""}`}>
            <Star className="size-3 fill-star text-star" />
            {a.rating.toFixed(2)}
          </span>
        ) : (
          "—"
        ),
    ],
    ["Ratings", (a) => compact(a.ratings_count)],
    ["Price", (a) => a.price ?? "—"],
    ["Version", (a) => a.version ?? "—"],
    ["Last update", (a) => date(a.updated_at_store)],
    ["Size", (a) => bytes(a.size_bytes)],
    ["Screenshots", (a) => a.screenshots_count],
    ["Reviews stored", (a) => a.reviews_count.toLocaleString()],
    [
      "Sentiment",
      (a) => {
        const s = a.insights?.sentiment
        if (!s) return <span className="text-muted-foreground">Not analysed</span>
        const t = s.positive + s.neutral + s.negative || 1
        const p = Math.round((s.positive / t) * 100)
        const n = Math.round((s.negative / t) * 100)
        return (
          <div className="grid min-w-32 gap-1">
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
              <div className="bg-success" style={{ width: `${p}%` }} />
              <div className="bg-muted-foreground/60" style={{ width: `${100 - p - n}%` }} />
              <div className="bg-destructive" style={{ width: `${n}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">
              {p}% positive · {n}% negative
            </span>
          </div>
        )
      },
    ],
    ["Top complaint", (a) => <span className="first-letter:uppercase">{a.insights?.complaints?.[0]?.label ?? "—"}</span>],
    ["Top request", (a) => <span className="first-letter:uppercase">{a.insights?.requests?.[0]?.label ?? "—"}</span>],
  ]

  return (
    <>
      <PageHeader title="Compare" description="Competitors side by side.">
        <ComparePicker options={all.map((a) => ({ id: a.id, name: a.name || a.store_id }))} selected={selected} />
      </PageHeader>
      {apps.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Pick apps to compare</EmptyTitle>
            <EmptyDescription>
              {all.length ? "Use the menu above to add two or more apps from your library." : "Add apps to your library first."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 w-36 bg-card pl-6" />
                {apps.map((a) => (
                  <TableHead key={a.id} className="min-w-48 py-3">
                    <div className="flex items-center gap-2.5">
                      <AppIcon name={a.name} path={a.icon_path} className="size-8" />
                      <Link href={`/apps/${a.id}`} className="truncate font-medium hover:underline">
                        {a.name || a.store_id}
                      </Link>
                      <RemoveFromCompare id={a.id} selected={selected} />
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(([label, cell]) => (
                <TableRow key={label}>
                  <TableCell className="sticky left-0 z-10 bg-card pl-6 text-muted-foreground">{label}</TableCell>
                  {apps.map((a) => (
                    <TableCell key={a.id} className="tabular-nums whitespace-normal">
                      {cell(a)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  )
}
