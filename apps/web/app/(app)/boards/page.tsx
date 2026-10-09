import type { Metadata } from "next"
import Link from "next/link"
import { Image as ImageIcon, MessageSquare } from "lucide-react"
import { listBoards } from "@lens/core"
import { NewBoardButton } from "@/components/board-dialogs"
import { PageHeader } from "@/components/page-header"
import { Card } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { mediaSrc } from "@/lib/format"

export const metadata: Metadata = { title: "Boards" }

export default async function BoardsPage() {
  const boards = await listBoards()
  return (
    <>
      <PageHeader
        title="Boards"
        description="Collect screenshots and reviews per project, then pull a whole board into your agent over MCP."
      >
        <NewBoardButton />
      </PageHeader>
      {boards.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No boards yet</EmptyTitle>
            <EmptyDescription>
              Create a board for a project, then use the bookmark button on any screenshot or review to save it there.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewBoardButton />
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <Card key={b.id} className="relative gap-4 p-4 transition-shadow hover:shadow-md">
              <Link
                href={`/boards/${b.id}`}
                className="absolute inset-0 rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label={`Open ${b.name}`}
              />
              <div className="grid h-36 grid-cols-4 gap-1.5 overflow-hidden rounded-lg bg-muted p-2">
                {b.preview.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={mediaSrc(p, 240)!} alt="" loading="lazy" className="w-full self-start rounded-md border object-cover" />
                ))}
              </div>
              <div className="grid gap-1">
                <div className="font-semibold">{b.name}</div>
                {b.description && <p className="line-clamp-2 text-sm text-muted-foreground">{b.description}</p>}
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <ImageIcon className="size-3" />
                  {b.screens} screens
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="size-3" />
                  {b.reviews} reviews
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
