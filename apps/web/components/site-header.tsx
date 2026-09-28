"use client"

import { usePathname } from "next/navigation"
import { AddAppDialog } from "@/components/add-app-dialog"
import { CommandMenu, type CommandApp } from "@/components/command-menu"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

const TITLES: [string, string][] = [
  ["/apps/", "App"],
  ["/apps", "Library"],
  ["/boards/", "Board"],
  ["/boards", "Boards"],
  ["/compare", "Compare"],
  ["/changes", "Changes"],
  ["/settings", "Settings"],
]

export function SiteHeader({ apps }: { apps: CommandApp[] }) {
  const pathname = usePathname()
  const title = pathname === "/" ? "Dashboard" : (TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? "")
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <span className="truncate text-sm font-medium">{title}</span>
      <div className="ml-auto flex items-center gap-2">
        <CommandMenu apps={apps} />
        <ThemeToggle />
        <AddAppDialog />
      </div>
    </header>
  )
}
