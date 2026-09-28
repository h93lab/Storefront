import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getBoard } from "@lens/core"
import { BoardActions, RemoveItemButton } from "@/components/board-dialogs"
import { CopyButton } from "@/components/copy-button"
import { PageHeader } from "@/components/page-header"
import { Stars } from "@/components/reviews-panel"
import { Card } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { mediaSrc } from "@/lib/format"

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const b = await getBoard((await params).id)
  return { title: b?.name ?? "Board" }
}

export default async function BoardPage({ params }: Params) {
  const board = await getBoard((await params).id)
  if (!board) notFound()
  const shots = board.items.filter((i) => i.kind === "screenshot")
  const reviews = board.items.filter((i) => i.kind === "review")
  return (
    <>
      <PageHeader title={board.name} description={board.description ?? undefined}>
        <CopyButton value={`Use the storefront-lens MCP tool get_board with board_id "${board.id}"`} label="Copy agent prompt" />
        <BoardActions board={board} />
      </PageHeader>
      {board.items.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>This board is empty</EmptyTitle>
            <EmptyDescription>Open an app, then use the bookmark button on a screenshot or review to save it here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {shots.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Screenshots · {shots.length}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {shots.map((i) => (
              <div key={i.id} className="grid content-start gap-2">
                <a
                  href={mediaSrc(i.screenshot_path)!}
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-hidden rounded-xl border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaSrc(i.screenshot_path)!} alt={`${i.app_name} screenshot`} loading="lazy" className="w-full" />
                </a>
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/apps/${i.app_id}?tab=screenshots`} className="truncate text-sm font-medium hover:underline">
                    {i.app_name}
                  </Link>
                  <RemoveItemButton itemId={i.id} />
                </div>
                {i.note && <p className="border-l-2 pl-2.5 text-xs text-muted-foreground">{i.note}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
      {reviews.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Reviews · {reviews.length}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reviews.map((i) => (
              <Card key={i.id} className="gap-2 p-4">
                <div className="flex items-center justify-between">
                  <Stars rating={i.review_rating} />
                  <RemoveItemButton itemId={i.id} />
                </div>
                <div className="font-medium">{i.review_title || "Untitled review"}</div>
                <p className="line-clamp-6 text-sm text-muted-foreground" dir="auto">
                  {i.review_body}
                </p>
                <Link href={`/apps/${i.app_id}?tab=reviews`} className="text-xs font-medium hover:underline">
                  {i.app_name}
                </Link>
                {i.note && <p className="border-l-2 pl-2.5 text-xs text-muted-foreground">{i.note}</p>}
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
