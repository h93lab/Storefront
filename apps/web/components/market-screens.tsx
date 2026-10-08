"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, Download, Play } from "lucide-react"
import type { MarketScreen } from "@lens/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { mediaSrc } from "@/lib/format"
import { SECTION_LABEL } from "@/lib/market"

const duration = (ms: number | null) => {
  if (!ms) return ""
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** Screens grouped section → flow, with a lightbox that lists UI elements and colours. Videos are placeholders. */
export function MarketScreens({ sections, appName }: { sections: { section: string; screens: MarketScreen[] }[]; appName: string }) {
  const flat = React.useMemo(() => sections.flatMap((s) => s.screens), [sections])
  const [index, setIndex] = React.useState<number | null>(null)
  const current = index == null ? null : flat[index]
  const step = React.useCallback((d: number) => setIndex((i) => (i == null ? i : (i + d + flat.length) % flat.length)), [flat.length])

  React.useEffect(() => {
    if (index == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") step(-1)
      if (e.key === "ArrowRight") step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, step])

  const open = (s: MarketScreen) => setIndex(flat.indexOf(s))
  const label = (s: MarketScreen) => s.name || `Screen ${(s.position ?? 0) + 1}`

  return (
    <>
      <div className="grid gap-8">
        {sections.map((sec) => {
          const flows: { flow: string; screens: MarketScreen[] }[] = []
          for (const s of sec.screens) {
            const name = s.flow ?? ""
            let g = flows.find((f) => f.flow === name)
            if (!g) flows.push((g = { flow: name, screens: [] }))
            g.screens.push(s)
          }
          return (
            <section key={sec.section} className="grid gap-4">
              <h2 className="text-base font-semibold">
                {SECTION_LABEL[sec.section] ?? sec.section}{" "}
                <span className="text-sm font-normal text-muted-foreground">{sec.screens.length}</span>
              </h2>
              {flows.map((g) => (
                <div key={g.flow} className="grid gap-2">
                  {g.flow && <h3 className="text-sm font-medium text-muted-foreground">{g.flow}</h3>}
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                    {g.screens.map((s) => (
                      <div key={s.screen_id} className="grid gap-2">
                        <button
                          type="button"
                          onClick={() => open(s)}
                          className="cursor-zoom-in overflow-hidden rounded-xl border bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                          aria-label={`View ${label(s)}`}
                        >
                          {s.kind === "image" && s.path ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={mediaSrc(s.path, 480)!} alt={`${appName} ${label(s)}`} loading="lazy" className="w-full" />
                          ) : (
                            <span
                              className="flex aspect-[9/19] w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
                              style={s.dominant_color ? { background: s.dominant_color + "33" } : undefined}
                            >
                              <Play className="size-6" />
                              {s.kind === "video" ? `Video ${duration(s.duration_ms)}` : "Image unavailable"}
                            </span>
                          )}
                        </button>
                        <span className="truncate text-xs text-muted-foreground">{label(s)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )
        })}
      </div>

      <Dialog open={index != null} onOpenChange={(o) => !o && setIndex(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{appName}</DialogTitle>
            <DialogDescription className="tabular-nums">
              {current
                ? `${label(current)} · ${SECTION_LABEL[current.section ?? ""] ?? current.section ?? ""}${current.flow ? ` · ${current.flow}` : ""}`
                : ""}{" "}
              · {index != null ? index + 1 : 0} of {flat.length}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-[1fr_14rem]">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Previous screen">
                <ChevronLeft />
              </Button>
              {current?.kind === "image" && current.path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaSrc(current.path)!}
                  alt={`${appName} ${label(current)}`}
                  className="mx-auto max-h-[60vh] w-auto rounded-xl border"
                />
              ) : (
                <div className="flex h-60 items-center justify-center rounded-xl border bg-muted text-sm text-muted-foreground">
                  {current?.kind === "video" ? `Video ${duration(current.duration_ms)} (not stored)` : "Image unavailable"}
                </div>
              )}
              <Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Next screen">
                <ChevronRight />
              </Button>
            </div>
            <div className="grid content-start gap-4 text-sm">
              {current && current.colors.length > 0 && (
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Colors</span>
                  <div className="flex flex-wrap gap-1.5">
                    {current.colors.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 font-mono text-xs">
                        <span className="size-4 rounded border" style={{ background: c }} />
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {current && current.ui_elements.length > 0 && (
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">UI elements</span>
                  <div className="flex flex-wrap gap-1">
                    {current.ui_elements.map((u) => (
                      <Badge key={u} variant="secondary" className="font-normal">
                        {u}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            {current?.path && (
              <Button variant="outline" asChild>
                <a href={mediaSrc(current.path)!} download={`${appName}-${label(current)}.webp`.replace(/\s+/g, "-")}>
                  <Download />
                  Download
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
