"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronLeft } from "lucide-react"
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
  ["/opportunities/", "Opportunity"],
  ["/opportunities", "Opportunities"],
  ["/import", "Import"],
  ["/compare", "Compare"],
  ["/changes", "Changes"],
  ["/settings", "Settings"],
]

export function SiteHeader({ apps }: { apps: CommandApp[] }) {
  const pathname = usePathname()
  const title = pathname === "/" ? "Dashboard" : (TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? "")
  // Detail pages get a back link to their list instead of a generic label.
  const parent = pathname.startsWith("/apps/")
    ? { href: "/apps", label: "Library" }
    : pathname.startsWith("/opportunities/")
      ? { href: "/opportunities", label: "Opportunities" }
      : pathname.startsWith("/boards/")
        ? { href: "/boards", label: "Boards" }
        : null
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      {parent ? (
        <Link
          href={parent.href}
          className="-ml-1 inline-flex items-center gap-1 truncate rounded-md px-1 py-1 text-sm font-medium hover:bg-accent"
        >
          <ChevronLeft className="size-4" />
          {parent.label}
        </Link>
      ) : (
        <span className="truncate text-sm font-medium">{title}</span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <CommandMenu apps={apps} />
        <ThemeToggle />
        <AddAppDialog />
      </div>
    </header>
  )
}
