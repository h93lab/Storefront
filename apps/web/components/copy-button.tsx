"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export function CopyButton({ value, label = "Copy", iconOnly }: { value: string; label?: string; iconOnly?: boolean }) {
  const [done, setDone] = React.useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size={iconOnly ? "icon" : "sm"}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          toast.error("Could not copy. Select the text and copy it manually.")
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      {!iconOnly && label}
    </Button>
  )
}
