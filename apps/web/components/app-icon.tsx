import { mediaSrc } from "@/lib/format"
import { cn } from "@/lib/utils"

export function AppIcon({ name, path, className }: { name: string; path: string | null; className?: string }) {
  const src = mediaSrc(path)
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn("size-11 shrink-0 rounded-[22%] border object-cover", className)} />
  ) : (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-[22%] border bg-muted font-semibold text-muted-foreground",
        className,
      )}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  )
}
