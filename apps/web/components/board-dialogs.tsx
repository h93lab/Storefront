"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { createBoardAction, deleteBoardAction, removeBoardItemAction, updateBoardAction } from "@/app/actions"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

function BoardForm({
  trigger,
  title,
  initial,
  submitLabel,
  onSubmit,
}: {
  trigger: React.ReactNode
  title: string
  initial?: { name: string; description: string | null }
  submitLabel: string
  onSubmit: (name: string, description: string) => Promise<boolean>
}) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(initial?.name ?? "")
  const [description, setDescription] = React.useState(initial?.description ?? "")
  const [pending, start] = React.useTransition()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            start(async () => {
              if (await onSubmit(name, description)) {
                setOpen(false)
                if (!initial) {
                  setName("")
                  setDescription("")
                }
              }
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Group screenshots and reviews for one project.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="board-name">Name</Label>
            <Input
              id="board-name"
              required
              autoFocus
              placeholder="e.g. Fitness app · Home screen"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="board-desc">Description</Label>
            <Textarea
              id="board-desc"
              placeholder="What is this board for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending && <Spinner />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function NewBoardButton() {
  const router = useRouter()
  return (
    <BoardForm
      title="New board"
      submitLabel="Create board"
      trigger={
        <Button size="sm">
          <Plus />
          New board
        </Button>
      }
      onSubmit={async (name, description) => {
        const r = await createBoardAction(name, description)
        if (!r.ok) {
          toast.error(r.error)
          return false
        }
        toast.success("Board created")
        router.push(`/boards/${r.data}`)
        return true
      }}
    />
  )
}

export function BoardActions({ board }: { board: { id: string; name: string; description: string | null } }) {
  const router = useRouter()
  const [confirm, setConfirm] = React.useState(false)
  return (
    <>
      <BoardForm
        title="Edit board"
        submitLabel="Save"
        initial={board}
        trigger={
          <Button variant="outline" size="sm">
            <Pencil />
            Edit
          </Button>
        }
        onSubmit={async (name, description) => {
          const r = await updateBoardAction(board.id, name, description)
          if (!r.ok) toast.error(r.error)
          else router.refresh()
          return r.ok
        }}
      />
      <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
        <Trash2 />
        Delete
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete “${board.name}”?`}
        description="The board and its notes are deleted. Screenshots and reviews stay in your library."
        confirmLabel="Delete board"
        onConfirm={async () => {
          const r = await deleteBoardAction(board.id)
          if (!r.ok) return void toast.error(r.error)
          toast.success("Board deleted")
          router.push("/boards")
        }}
      />
    </>
  )
}

export function RemoveItemButton({ itemId }: { itemId: string }) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label="Remove from board"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await removeBoardItemAction(itemId)
          if (r.ok) toast.success("Removed from board")
          else toast.error(r.error)
          router.refresh()
        })
      }
    >
      {pending ? <Spinner /> : <Trash2 />}
    </Button>
  )
}
