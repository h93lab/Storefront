import { Smartphone } from "lucide-react"

/** Minimal shell for /login and /setup: no sidebar, no navSummary(), no database work. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Smartphone className="size-4" />
        </div>
        <span className="font-semibold">Storefront Lens</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  )
}
