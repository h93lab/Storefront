"use client"

import * as React from "react"
import { ArrowLeftRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { mediaSrc } from "@/lib/format"

export function BeforeAfter({ appName, when, before, after }: { appName: string; when: string; before: string[]; after: string[] }) {
  const row = (paths: string[], other: string[]) => (
    <ScrollArea className="w-full whitespace-nowrap">
      <div className="flex gap-3 pb-3">
        {paths.map((p) => (
          <div key={p} className="relative w-28 shrink-0 sm:w-32">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaSrc(p)!} alt="" className={`rounded-lg border ${other.includes(p) ? "opacity-50" : "ring-2 ring-warning"}`} />
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowLeftRight />
          Compare before / after
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Screenshots changed</DialogTitle>
          <DialogDescription>
            {appName} · detected {when}. Highlighted screens are the ones that differ.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-2">
            <Badge variant="secondary" className="bg-destructive/15 text-destructive">
              Before
            </Badge>
            {row(before, after)}
          </div>
          <div className="grid min-w-0 gap-2">
            <Badge variant="secondary" className="bg-success/15 text-success">
              After
            </Badge>
            {row(after, before)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
