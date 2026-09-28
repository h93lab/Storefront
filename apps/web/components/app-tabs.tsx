"use client"

import { useUrlState } from "@/components/library-filters"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function AppTabs({ tab, counts }: { tab: string; counts: { reviews: number; screenshots: number; changes: number } }) {
  const { set } = useUrlState()
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => set({ tab: v === "overview" ? null : v, rating: null, q: null, topic: null, sort: null, limit: null })}
    >
      <TabsList className="max-w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="screenshots">
          Screenshots <span className="text-muted-foreground tabular-nums">{counts.screenshots}</span>
        </TabsTrigger>
        <TabsTrigger value="reviews">
          Reviews <span className="text-muted-foreground tabular-nums">{counts.reviews}</span>
        </TabsTrigger>
        <TabsTrigger value="insights">AI insights</TabsTrigger>
        <TabsTrigger value="changes">
          Changes
          {counts.changes > 0 && <Badge className="bg-warning/15 px-1.5 py-0 text-foreground tabular-nums">{counts.changes}</Badge>}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
