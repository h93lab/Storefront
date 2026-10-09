import { navSummary } from "@lens/core"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { requireSession } from "@/lib/auth-server"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts only checks the cookie signature; this also rejects sessions from before the last password change.
  await requireSession()
  const nav = await navSummary()
  return (
    <SidebarProvider>
      <AppSidebar appCount={nav.apps.length} boardCount={nav.boards} opportunityCount={nav.opportunities} reviewCount={nav.verdicts} />
      <SidebarInset>
        <SiteHeader apps={nav.apps} reviewCount={nav.verdicts} />
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
