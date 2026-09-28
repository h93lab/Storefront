"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { syncAllAction, syncAppAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function SyncButton({ appId, label = "Sync now", busy }: { appId?: string; label?: string; busy?: boolean }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const spinning = pending || busy
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={spinning}
      onClick={() =>
        start(async () => {
          const r = appId ? await syncAppAction(appId) : await syncAllAction()
          if (r.ok) toast.success(r.message ?? "Sync queued", { description: "The worker picks it up within a few seconds." })
          else toast.error(r.error)
          router.refresh()
        })
      }
    >
      <RefreshCw className={cn(spinning && "animate-spin")} />
      {busy ? "Syncing…" : label}
    </Button>
  )
}
