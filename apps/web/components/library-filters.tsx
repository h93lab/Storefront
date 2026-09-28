"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function useUrlState() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, start] = React.useTransition()
  const set = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "" || v === "all") next.delete(k)
        else next.set(k, v)
      }
      const qs = next.toString()
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
    },
    [params, pathname, router],
  )
  return { params, set, pending }
}

export function DebouncedSearch({ param = "q", placeholder, className }: { param?: string; placeholder: string; className?: string }) {
  const { params, set } = useUrlState()
  const [value, setValue] = React.useState(params.get(param) ?? "")
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => set({ [param]: value.trim() || null }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <InputGroup className={className ?? "w-full sm:max-w-xs"}>
      <InputGroupInput placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} aria-label={placeholder} />
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
    </InputGroup>
  )
}

export function LibraryFilters({
  categories,
  children,
  controls = true,
}: {
  categories: string[]
  children: React.ReactNode
  controls?: boolean
}) {
  const { params, set, pending } = useUrlState()
  return (
    <>
      {controls && (
        <div className="flex flex-wrap items-center gap-2">
          <DebouncedSearch placeholder="Search your library…" />
          <Tabs value={params.get("store") ?? "all"} onValueChange={(v) => set({ store: v })}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="ios">App Store</TabsTrigger>
              <TabsTrigger value="android">Google Play</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={params.get("category") ?? "all"} onValueChange={(v) => set({ category: v })}>
            <SelectTrigger className="w-48" aria-label="Category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div aria-busy={pending} className={pending ? "pointer-events-none opacity-50 transition-opacity" : "transition-opacity"}>
        {children}
      </div>
    </>
  )
}
