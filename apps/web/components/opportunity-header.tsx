"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GitMerge, MoreHorizontal, Pencil, Skull } from "lucide-react"
import { toast } from "sonner"
import { mergeOpportunitiesAction, setOpportunityStatusAction, updateOpportunityAction } from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { date } from "@/lib/format"

const STATUSES = ["surfaced", "validating", "building", "shipped", "killed"] as const
type Status = (typeof STATUSES)[number]

export interface HeaderOpportunity {
  id: number
  label: string
  kind: string
  status: Status
  killed_reason: string | null
  revisit_after: string | null
}

export interface SimilarChip {
  id: number
  label: string
  status: string
}

export function OpportunityHeader({
  opp,
  mergeTargets,
  similar = [],
}: {
  opp: HeaderOpportunity
  mergeTargets: { id: number; label: string }[]
  similar?: SimilarChip[]
}) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const [editing, setEditing] = React.useState(false)
  const [label, setLabel] = React.useState(opp.label)
  const [killing, setKilling] = React.useState(false)
  const [reason, setReason] = React.useState(opp.killed_reason ?? "")
  const [revisit, setRevisit] = React.useState(opp.revisit_after?.slice(0, 10) ?? "")
  const [merging, setMerging] = React.useState(false)
  const [target, setTarget] = React.useState("")

  const setStatus = (status: Status, opts?: { reason?: string; revisitAfter?: string | null }) =>
    start(async () => {
      const r = await setOpportunityStatusAction(opp.id, status, opts)
      if (r.ok) {
        toast.success(r.message ?? "Saved")
        setKilling(false)
      } else toast.error(r.error)
      router.refresh()
    })

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid min-w-0 gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{opp.label}</h1>
          <Button variant="ghost" size="icon" aria-label="Edit label" onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="capitalize">
            {opp.kind}
          </Badge>
          {opp.status === "killed" && (
            <span className="text-sm text-muted-foreground">
              Killed{opp.killed_reason ? `: ${opp.killed_reason}` : ""}
              {opp.revisit_after ? ` · revisit ${date(opp.revisit_after)}` : ""}
            </span>
          )}
        </div>
        {similar.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Similar opportunities</span>
            {similar.map((s) => (
              <Badge
                key={s.id}
                variant={s.status === "killed" ? "secondary" : "outline"}
                className={s.status === "killed" ? "bg-destructive/15 text-destructive" : undefined}
                asChild
              >
                <Link href={`/opportunities/${s.id}`} title={s.status === "killed" ? "Previously killed" : undefined}>
                  {s.label}
                  {s.status === "killed" && <span className="opacity-70">killed</span>}
                </Link>
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={opp.status}
          disabled={pending}
          onValueChange={(v) => {
            if (v === "killed") setKilling(true)
            else setStatus(v as Status)
          }}
        >
          <SelectTrigger className="w-40 capitalize" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setMerging(true)} disabled={mergeTargets.length === 0}>
              <GitMerge />
              Merge into…
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setKilling(true)}>
              <Skull />
              Kill
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              start(async () => {
                const r = await updateOpportunityAction(opp.id, { label })
                if (r.ok) {
                  toast.success("Label saved")
                  setEditing(false)
                } else toast.error(r.error)
                router.refresh()
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit label</DialogTitle>
              <DialogDescription>Rename this opportunity. Grouped review labels are kept.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="opp-label">Label</Label>
              <Input id="opp-label" required autoFocus maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !label.trim()}>
                {pending && <Spinner />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={killing} onOpenChange={setKilling}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setStatus("killed", { reason, revisitAfter: revisit || null })
            }}
          >
            <DialogHeader>
              <DialogTitle>Kill this opportunity</DialogTitle>
              <DialogDescription>
                Record why, so it lands in the graveyard with a reason. Optionally set a date to look at it again.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="kill-reason">Reason</Label>
              <Textarea id="kill-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kill-revisit">Revisit after</Label>
              <Input id="kill-revisit" type="date" value={revisit} onChange={(e) => setRevisit(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setKilling(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <Spinner />}
                Kill
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={merging} onOpenChange={setMerging}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              start(async () => {
                const r = await mergeOpportunitiesAction(opp.id, Number(target))
                if (r.ok) {
                  toast.success(r.message ?? "Merged")
                  router.push(`/opportunities/${target}`)
                } else toast.error(r.error)
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>Merge into another opportunity</DialogTitle>
              <DialogDescription>All labels move to the target and this opportunity is deleted. This cannot be undone.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="merge-target">Target</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger id="merge-target" className="w-full">
                  <SelectValue placeholder="Choose an opportunity" />
                </SelectTrigger>
                <SelectContent>
                  {mergeTargets.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMerging(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !target}>
                {pending && <Spinner />}
                Merge
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
