"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import {
  Bookmark,
  ClipboardPaste,
  GitCompare,
  History,
  LayoutDashboard,
  Lightbulb,
  Library,
  ListChecks,
  Moon,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react"
import { toast } from "sonner"
import { syncAllAction } from "@/app/actions"
import { AppIcon } from "@/components/app-icon"
import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { storeLabel } from "@/lib/format"

export interface CommandApp {
  id: string
  name: string
  store: string
  icon: string | null
}

export function CommandMenu({ apps, reviewCount }: { apps: CommandApp[]; reviewCount: number }) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  const go = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-8 justify-start gap-2 px-2 text-muted-foreground sm:w-56 sm:px-3"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <Search />
        <span className="hidden sm:inline">Search apps, actions…</span>
        <Kbd className="ml-auto hidden sm:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search apps and actions">
        <CommandInput placeholder="Type an app name or command…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {apps.length > 0 && (
            <CommandGroup heading="Apps">
              {apps.map((a) => (
                <CommandItem key={a.id} value={`${a.name} ${a.id}`} onSelect={() => go(() => router.push(`/apps/${a.id}`))}>
                  <AppIcon name={a.name} path={a.icon} className="size-5 rounded-md" />
                  {a.name}
                  <CommandShortcut>{storeLabel(a.store)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading="Go to">
            {[
              ["/", "Dashboard", LayoutDashboard],
              ["/apps", "Library", Library],
              ["/boards", "Boards", Bookmark],
              ["/opportunities", "Opportunities", Lightbulb],
              ["/import", "Import", ClipboardPaste],
              ["/review", "Review", ListChecks],
              ["/compare", "Compare", GitCompare],
              ["/changes", "Changes", History],
              ["/settings", "Settings", Settings],
            ].map(([href, label, Icon]) => {
              const I = Icon as typeof Search
              return (
                <CommandItem key={href as string} onSelect={() => go(() => router.push(href as string))}>
                  <I />
                  {label as string}
                  {href === "/review" && <CommandShortcut>{reviewCount}</CommandShortcut>}
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() =>
                go(async () => {
                  const r = await syncAllAction()
                  if (r.ok) toast.success("Sync queued for all apps")
                  else toast.error(r.error)
                })
              }
            >
              <RefreshCw />
              Sync all apps now
            </CommandItem>
            <CommandItem onSelect={() => go(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              <Moon />
              Toggle theme
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
