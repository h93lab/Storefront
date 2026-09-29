"use client"

import * as React from "react"
import { DebouncedSearch, useUrlState } from "@/components/library-filters"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const STATUSES = ["active", "surfaced", "validating", "building", "shipped", "killed", "all"]

export function OpportunityFilters({ children }: { children: React.ReactNode }) {
  const { params, set, pending } = useUrlState()
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <DebouncedSearch placeholder="Search opportunities…" />
        <Select value={params.get("status") ?? "active"} onValueChange={(v) => set({ status: v === "active" ? null : v })}>
          <SelectTrigger className="w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s === "all" ? "All statuses" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.get("kind") ?? "all"} onValueChange={(v) => set({ kind: v })}>
          <SelectTrigger className="w-40" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="complaint">Complaints</SelectItem>
            <SelectItem value="request">Requests</SelectItem>
          </SelectContent>
        </Select>
        <Tabs value={params.get("own") === "only" ? "only" : "exclude"} onValueChange={(v) => set({ own: v === "only" ? "only" : null })}>
          <TabsList>
            <TabsTrigger value="exclude">Competitors</TabsTrigger>
            <TabsTrigger value="only">My apps</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div aria-busy={pending} className={pending ? "pointer-events-none opacity-50 transition-opacity" : "transition-opacity"}>
        {children}
      </div>
    </>
  )
}
