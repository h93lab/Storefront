"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setAppLanguageAction } from "@/app/actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LANGUAGES } from "@/lib/format"

/** Changes which language's reviews Google Play returns for this app, then resyncs. */
export function LanguageSelect({ appId, value }: { appId: string; value: string }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const options = LANGUAGES.some(([c]) => c === value) ? LANGUAGES : [...LANGUAGES, [value, value] as [string, string]]
  return (
    <Select
      value={value}
      disabled={pending}
      onValueChange={(v) =>
        start(async () => {
          const r = await setAppLanguageAction(appId, v)
          if (r.ok) toast.success(r.message ?? "Saved")
          else toast.error(r.error)
          router.refresh()
        })
      }
    >
      <SelectTrigger size="sm" className="ml-auto h-7 w-auto gap-1 px-2 text-sm" aria-label="Review language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map(([code, name]) => (
          <SelectItem key={code} value={code}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
