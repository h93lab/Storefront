"use client"

import Link from "next/link"
import { X } from "lucide-react"
import { useUrlState } from "@/components/library-filters"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function ComparePicker({ options, selected }: { options: { id: string; name: string }[]; selected: string[] }) {
  const { set } = useUrlState()
  const rest = options.filter((o) => !selected.includes(o.id))
  return (
    <Select value="" onValueChange={(v) => set({ ids: [...selected, v].join(",") })} disabled={!rest.length || selected.length >= 8}>
      <SelectTrigger className="w-56" aria-label="Add app to compare">
        <SelectValue placeholder={rest.length ? "Add app to compare…" : "All apps added"} />
      </SelectTrigger>
      <SelectContent>
        {rest.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function RemoveFromCompare({ id, selected }: { id: string; selected: string[] }) {
  const next = selected.filter((x) => x !== id)
  return (
    <Button variant="ghost" size="icon" className="size-7" asChild>
      <Link href={next.length ? `/compare?ids=${next.join(",")}` : "/compare"} aria-label="Remove from comparison" scroll={false}>
        <X />
      </Link>
    </Button>
  )
}
