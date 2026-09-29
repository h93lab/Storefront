"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Layers } from "lucide-react"
import { toast } from "sonner"
import { groupLabelsAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function GroupLabelsButton({ busy }: { busy?: boolean }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || busy}
      onClick={() =>
        start(async () => {
          const r = await groupLabelsAction()
          if (r.ok) toast.success("Grouping queued", { description: "The list refreshes when the worker finishes." })
          else toast.error(r.error)
          router.refresh()
        })
      }
    >
      {pending || busy ? <Spinner /> : <Layers />}
      {busy ? "Grouping…" : "Group new labels"}
    </Button>
  )
}
