"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Link2, Unlink } from "lucide-react"
import { toast } from "sonner"
import { disconnectAppllamaAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/** Shows the outcome of the OAuth round trip once, then clears the query string. */
export function AppllamaToasts() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const done = React.useRef(false)
  React.useEffect(() => {
    if (done.current) return
    const err = params.get("appllama_error")
    const ok = params.get("connected") === "1"
    if (!err && !ok) return
    done.current = true
    if (err) toast.error(err)
    else toast.success("Appllama connected")
    router.replace(`${pathname}#appllama`, { scroll: false })
  }, [params, router, pathname])
  return null
}

export function AppllamaControls({ connected }: { connected: boolean }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  if (!connected)
    return (
      <Button asChild>
        <a href="/api/appllama/connect">
          <Link2 />
          Connect Appllama
        </a>
      </Button>
    )
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await disconnectAppllamaAction()
          if (r.ok) toast.success("Appllama disconnected")
          else toast.error(r.error)
          router.refresh()
        })
      }
    >
      {pending ? <Spinner /> : <Unlink />}
      Disconnect
    </Button>
  )
}
