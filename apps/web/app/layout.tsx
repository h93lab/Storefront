import type { Metadata } from "next"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"
import { navSummary } from "@lens/core"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { ThemeProvider } from "@/components/theme-provider"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: { default: "Storefront Lens", template: "%s · Storefront Lens" },
  description: "Personal library of App Store and Google Play apps",
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nav = await navSummary()
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>
            <SidebarProvider>
              <AppSidebar
                appCount={nav.apps.length}
                boardCount={nav.boards}
                opportunityCount={nav.opportunities}
                reviewCount={nav.verdicts}
              />
              <SidebarInset>
                <SiteHeader apps={nav.apps} reviewCount={nav.verdicts} />
                <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
              </SidebarInset>
            </SidebarProvider>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
