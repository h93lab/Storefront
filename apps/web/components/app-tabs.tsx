"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

/**
 * Tab bar for the app page. The selected tab switches instantly while the
 * server renders the new content, which is dimmed until it arrives.
 */
export function AppTabs({
  tab,
  counts,
  market,
  children,
}: {
  tab: string
  counts: { reviews: number; screenshots: number; changes: number }
  market?: { screens: number } | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, start] = React.useTransition()
  const [selected, setSelected] = React.useState(tab)
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => setSelected(tab), [tab])
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-value="${selected}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [selected])

  const go = (v: string) => {
    setSelected(v)
    const next = new URLSearchParams(params.toString())
    for (const k of ["tab", "rating", "q", "topic", "sort", "limit", "all"]) next.delete(k)
    if (v !== "overview") next.set("tab", v)
    const qs = next.toString()
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  const triggers: [string, React.ReactNode][] = [
    ["overview", "Overview"],
    [
      "screenshots",
      <>
        <span className="sm:hidden">Shots</span>
        <span className="hidden sm:inline">Screenshots</span>
        <span className="text-muted-foreground tabular-nums">{counts.screenshots}</span>
      </>,
    ],
    ...(market
      ? ([
          ["market", "Market"],
          [
            "screens",
            <>
              Market screens <span className="text-muted-foreground tabular-nums">{market.screens}</span>
            </>,
          ],
        ] as [string, React.ReactNode][])
      : []),
    [
      "reviews",
      <>
        Reviews <span className="text-muted-foreground tabular-nums">{counts.reviews}</span>
      </>,
    ],
    [
      "insights",
      <>
        <span className="sm:hidden">AI</span>
        <span className="hidden sm:inline">AI insights</span>
      </>,
    ],
    [
      "changes",
      <>
        Changes
        {counts.changes > 0 && <Badge className="bg-warning/15 px-1.5 py-0 text-foreground tabular-nums">{counts.changes}</Badge>}
      </>,
    ],
  ]

  return (
    <>
      <Tabs value={selected} onValueChange={go}>
        {/* Scrolls sideways on narrow screens without showing a scrollbar. */}
        <div
          ref={listRef}
          className="-mx-4 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          <TabsList className="flex w-max">
            {triggers.map(([value, label]) => (
              <TabsTrigger key={value} value={value} data-value={value} className="flex-none px-2 sm:px-3">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      <div aria-busy={pending} className={cn("grid gap-6 transition-opacity", pending && "pointer-events-none opacity-50")}>
        {children}
      </div>
    </>
  )
}
