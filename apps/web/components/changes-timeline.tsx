import Link from "next/link"
import { AppWindow, FileText, History, Image as ImageIcon, RefreshCw, Tag, Type } from "lucide-react"
import { getScreenshotsByHashes, type Change } from "@lens/core"
import { AppIcon } from "@/components/app-icon"
import { BeforeAfter } from "@/components/before-after"
import { Badge } from "@/components/ui/badge"
import { ago, date, FIELD_LABELS } from "@/lib/format"

const ICONS: Record<string, typeof History> = {
  screenshots: ImageIcon,
  description: FileText,
  price: Tag,
  version: RefreshCw,
  name: Type,
  icon: AppWindow,
  release_notes: FileText,
}

function TextDiff({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const clip = (v: unknown) => {
    const s = v == null ? "—" : String(v)
    return s.length > 600 ? `${s.slice(0, 600)}…` : s
  }
  return (
    <div className="mt-1 overflow-hidden rounded-md border text-sm">
      <div className="bg-destructive/10 px-3 py-1.5 whitespace-pre-wrap" dir="auto">
        <span className="mr-2 font-mono text-destructive">−</span>
        {clip(oldValue)}
      </div>
      <div className="bg-success/10 px-3 py-1.5 whitespace-pre-wrap" dir="auto">
        <span className="mr-2 font-mono text-success">+</span>
        {clip(newValue)}
      </div>
    </div>
  )
}

export async function ChangesTimeline({ changes, showApp }: { changes: Change[]; showApp?: boolean }) {
  const shots = await Promise.all(
    changes.map(async (c) =>
      c.field === "screenshots"
        ? {
            before: (await getScreenshotsByHashes(c.app_id, (c.old_value as string[]) ?? [])).map((s) => s.path),
            after: (await getScreenshotsByHashes(c.app_id, (c.new_value as string[]) ?? [])).map((s) => s.path),
          }
        : null,
    ),
  )
  return (
    <ol className="grid">
      {changes.map((c, i) => {
        const Icon = ICONS[c.field] ?? History
        const s = shots[i]
        return (
          <li key={c.id} className="relative grid grid-cols-[2rem_1fr] gap-3 pb-6 last:pb-0">
            {i < changes.length - 1 && <span className="absolute top-8 bottom-0 left-4 w-px bg-border" aria-hidden />}
            <span className="flex size-8 items-center justify-center rounded-full border bg-background">
              <Icon className="size-3.5" />
            </span>
            <div className="grid min-w-0 gap-1.5 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {showApp && (
                  <Link href={`/apps/${c.app_id}?tab=changes`} className="inline-flex items-center gap-2 font-medium hover:underline">
                    <AppIcon name={c.app_name} path={c.app_icon} className="size-5 rounded-md" />
                    {c.app_name}
                  </Link>
                )}
                <Badge className="bg-warning/15 text-foreground">{FIELD_LABELS[c.field] ?? c.field}</Badge>
                <span className="text-xs text-muted-foreground" title={date(c.detected_at, true)}>
                  {ago(c.detected_at)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{c.summary}</p>
              {s && s.before.length > 0 && s.after.length > 0 && (
                <div>
                  <BeforeAfter appName={c.app_name} when={date(c.detected_at)} before={s.before} after={s.after} />
                </div>
              )}
              {["price", "version", "name", "description", "release_notes"].includes(c.field) && (
                <TextDiff oldValue={c.old_value} newValue={c.new_value} />
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
