"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bookmark, Check, Folder, Plus } from "lucide-react"
import { toast } from "sonner"
import { createBoardAction, saveToBoardAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export interface BoardOption {
  id: string
  name: string
  count: number
}

export type SaveTarget = { kind: "screenshot"; screenshotId: string } | { kind: "review"; appId: string; reviewId: string }

export function SaveToBoardDialog({
  open,
  onOpenChange,
  target,
  boards,
  subject,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  target: SaveTarget | null
  boards: BoardOption[]
  subject: string
}) {
  const router = useRouter()
  const [picked, setPicked] = React.useState<string | null>(boards[0]?.id ?? null)
  const [newName, setNewName] = React.useState("")
  const [note, setNote] = React.useState("")
  const [pending, start] = React.useTransition()
  const creating = boards.length === 0 || picked === "new"

  React.useEffect(() => {
    if (open) {
      setNote("")
      setNewName("")
      setPicked(boards[0]?.id ?? "new")
    }
  }, [open, boards])

  function save() {
    if (!target) return
    start(async () => {
      let boardId = picked
      let boardName = boards.find((b) => b.id === picked)?.name ?? newName
      if (creating) {
        const r = await createBoardAction(newName)
        if (!r.ok) return void toast.error(r.error)
        boardId = r.data!
        boardName = newName.trim()
      }
      const r = await saveToBoardAction(boardId!, { ...target, note })
      if (!r.ok) return void toast.error(r.error)
      toast.success(r.data ? `Saved to “${boardName}”` : `Already on “${boardName}”`)
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save to board</DialogTitle>
          <DialogDescription>{subject}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-60 gap-2 overflow-y-auto">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={picked === b.id}
              onClick={() => setPicked(b.id)}
              className={cn(
                "flex items-center gap-3 rounded-md border p-2.5 text-left text-sm hover:bg-accent",
                picked === b.id && "border-ring bg-accent",
              )}
            >
              <Folder className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{b.name}</div>
                <div className="text-xs text-muted-foreground">{b.count} items</div>
              </div>
              {picked === b.id && <Check className="size-4" />}
            </button>
          ))}
          {boards.length > 0 && (
            <button
              type="button"
              aria-pressed={picked === "new"}
              onClick={() => setPicked("new")}
              className={cn(
                "flex items-center gap-3 rounded-md border border-dashed p-2.5 text-left text-sm hover:bg-accent",
                picked === "new" && "border-ring bg-accent",
              )}
            >
              <Plus className="size-4 text-muted-foreground" />
              New board
            </button>
          )}
        </div>
        {creating && (
          <div className="grid gap-2">
            <Label htmlFor="new-board">Board name</Label>
            <Input
              id="new-board"
              autoFocus
              placeholder="e.g. Meditation app · Onboarding"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="board-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="board-note" placeholder="Why is this a good reference?" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || (creating && !newName.trim())}>
            {pending && <Spinner />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SaveButton({ onClick, label = "Save to board" }: { onClick: () => void; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClick} aria-label={label}>
          <Bookmark />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
