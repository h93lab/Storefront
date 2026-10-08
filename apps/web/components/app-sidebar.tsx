"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Bookmark,
  ClipboardPaste,
  GitCompare,
  History,
  ListChecks,
  LayoutDashboard,
  Lightbulb,
  Store,
  Library,
  Settings,
  Smartphone,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/apps", label: "Library", icon: Library, count: "apps" as const },
  { href: "/boards", label: "Boards", icon: Bookmark, count: "boards" as const },
  { href: "/opportunities", label: "Opportunities", icon: Lightbulb, count: "opportunities" as const },
  { href: "/market", label: "Market", icon: Store },
  { href: "/import", label: "Import", icon: ClipboardPaste },
  { href: "/review", label: "Review", icon: ListChecks, count: "verdicts" as const },
  { href: "/compare", label: "Compare", icon: GitCompare },
  { href: "/changes", label: "Changes", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppSidebar({
  appCount,
  boardCount,
  opportunityCount,
  reviewCount,
}: {
  appCount: number
  boardCount: number
  opportunityCount: number
  reviewCount: number
}) {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))
  const counts = { apps: appCount, boards: boardCount, opportunities: opportunityCount, verdicts: reviewCount }
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Smartphone className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Storefront Lens</span>
                  <span className="truncate text-xs text-muted-foreground">Personal app library</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={active(item.href)} tooltip={item.label}>
                    <Link href={item.href} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.count ? <SidebarMenuBadge>{counts[item.count]}</SidebarMenuBadge> : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-4 pb-4 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        Data from the public App Store and Google Play listings.
      </SidebarFooter>
    </Sidebar>
  )
}
