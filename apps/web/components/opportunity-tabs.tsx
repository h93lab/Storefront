"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export function OpportunityTabs({ tab, evidenceCount, children }: { tab: string; evidenceCount: number; children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, start] = React.useTransition()
  const [selected, setSelected] = React.useState(tab)
  React.useEffect(() => setSelected(tab), [tab])
  const go = (v: string) => {
    setSelected(v)
    const next = new URLSearchParams(params.toString())
    if (v === "evidence") next.delete("tab")
    else next.set("tab", v)
    const qs = next.toString()
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  return (
    <>
      <Tabs value={selected} onValueChange={go}>
        <TabsList>
          <TabsTrigger value="evidence">
            Evidence <span className="text-muted-foreground tabular-nums">{evidenceCount}</span>
          </TabsTrigger>
          <TabsTrigger value="gate">Gate</TabsTrigger>
          <TabsTrigger value="spec">Spec</TabsTrigger>
          <TabsTrigger value="outcome">Outcome</TabsTrigger>
        </TabsList>
      </Tabs>
      <div aria-busy={pending} className={cn("grid gap-6 transition-opacity", pending && "pointer-events-none opacity-50")}>
        {children}
      </div>
    </>
  )
}
