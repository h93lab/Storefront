"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { marketRefreshAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function MarketRefreshButton({ appId, estimate, busy }: { appId: string; estimate: number; busy?: boolean }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || busy}
      onClick={() =>
        start(async () => {
          const r = await marketRefreshAction(appId)
          if (r.ok) toast.success(`Refresh queued (about ${r.data?.estimate ?? estimate} credits)`)
          else toast.error(r.error)
          router.refresh()
        })
      }
    >
      {pending || busy ? <Spinner /> : <RefreshCw />}
      Refresh (≈{estimate} credits)
    </Button>
  )
}
