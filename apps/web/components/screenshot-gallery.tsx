"use client"

import * as React from "react"
import { Bookmark, ChevronLeft, ChevronRight, Download } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { mediaSrc } from "@/lib/format"
import { SaveButton, SaveToBoardDialog, type BoardOption } from "@/components/save-to-board"

export interface GalleryShot {
  id: string
  path: string
  label: string
  isNew?: boolean
  active?: boolean
}

export function ScreenshotGallery({
  shots,
  appName,
  boards,
  columns = "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6",
}: {
  shots: GalleryShot[]
  appName: string
  boards: BoardOption[]
  columns?: string
}) {
  const [index, setIndex] = React.useState<number | null>(null)
  const [saving, setSaving] = React.useState<GalleryShot | null>(null)
  const current = index == null ? null : shots[index]
  const step = React.useCallback((d: number) => setIndex((i) => (i == null ? i : (i + d + shots.length) % shots.length)), [shots.length])

  React.useEffect(() => {
    if (index == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") step(-1)
      if (e.key === "ArrowRight") step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, step])

  return (
    <>
      <div className={`grid gap-4 ${columns}`}>
        {shots.map((s, i) => (
          <div key={s.id} className="grid gap-2">
            <button
              type="button"
              onClick={() => setIndex(i)}
              className="cursor-zoom-in overflow-hidden rounded-xl border bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label={`View ${s.label}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaSrc(s.path)!} alt={`${appName} ${s.label}`} loading="lazy" className="w-full" />
            </button>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">
                {s.label}
                {s.isNew && <Badge className="ml-1.5 bg-warning/15 px-1.5 py-0 text-foreground">new</Badge>}
                {s.active === false && (
                  <Badge variant="outline" className="ml-1.5 px-1.5 py-0">
                    removed
                  </Badge>
                )}
              </span>
              <SaveButton onClick={() => setSaving(s)} />
            </div>
          </div>
        ))}
      </div>

      <Dialog open={index != null} onOpenChange={(o) => !o && setIndex(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{appName}</DialogTitle>
            <DialogDescription className="tabular-nums">
              {current?.label} · {index != null ? index + 1 : 0} of {shots.length}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Previous screenshot">
              <ChevronLeft />
            </Button>
            {current && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaSrc(current.path)!}
                alt={`${appName} ${current.label}`}
                className="mx-auto max-h-[65vh] w-auto rounded-xl border"
              />
            )}
            <Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Next screenshot">
              <ChevronRight />
            </Button>
          </div>
          <DialogFooter>
            {current && (
              <Button variant="outline" asChild>
                <a href={mediaSrc(current.path)!} download={`${appName}-${current.label}.webp`.replace(/\s+/g, "-")}>
                  <Download />
                  Download
                </a>
              </Button>
            )}
            <Button
              onClick={() => {
                if (current) setSaving(current)
                setIndex(null)
              }}
            >
              <Bookmark />
              Save to board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SaveToBoardDialog
        open={saving != null}
        onOpenChange={(o) => !o && setSaving(null)}
        target={saving ? { kind: "screenshot", screenshotId: saving.id } : null}
        boards={boards}
        subject={saving ? `${appName} · ${saving.label}` : ""}
      />
    </>
  )
}
