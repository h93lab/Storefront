"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"
import { analyseAppAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function AnalyseButton({ appId, busy, label = "Re-analyse" }: { appId: string; busy?: boolean; label?: string }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || busy}
      onClick={() =>
        start(async () => {
          const r = await analyseAppAction(appId)
          if (r.ok) toast.success("Analysis queued", { description: "Results appear here when the worker finishes." })
          else toast.error(r.error)
          router.refresh()
        })
      }
    >
      {pending || busy ? <Spinner /> : <Sparkles />}
      {busy ? "Analysing…" : label}
    </Button>
  )
}
