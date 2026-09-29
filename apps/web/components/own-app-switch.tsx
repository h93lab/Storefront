"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setAppOwnAction } from "@/app/actions"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export function OwnAppSwitch({ appId, own }: { appId: string; own: boolean }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <Label htmlFor="own-app" className="font-normal">
        This is my app
      </Label>
      <Switch
        id="own-app"
        checked={own}
        disabled={pending}
        onCheckedChange={(v) =>
          start(async () => {
            const r = await setAppOwnAction(appId, v)
            if (r.ok) toast.success(r.message ?? "Saved")
            else toast.error(r.error)
            router.refresh()
          })
        }
      />
    </div>
  )
}
